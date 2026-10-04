import { createHook } from "node:async_hooks";
import native from "node:fs";
import * as fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

test("file store uses one fresh target inspection per read and list, and rechecks later links", async (t) => {
  const box = await sandbox(t, { git: false });
  const outside = await sandbox(t, { git: false });
  await box.write("nested/file", "original bytes");
  await outside.write("file", "outside bytes");
  const base = await fs.realpath(box.root);
  const target = join(base, "nested/file");
  const directory = join(base, "nested");
  /** @type {string[]} */ const inspected = [];
  const files = await createFileStore(base, {
    ...fs,
    lstat: /** @type {typeof fs.lstat} */ (
      /** @type {unknown} */ (
        async (/** @type {string} */ path) => {
          inspected.push(path);
          return fs.lstat(path);
        }
      )
    ),
  });
  for (const count of [1, 2]) {
    t.assert.equal(await files.readText("nested/file"), "original bytes");
    t.assert.equal(inspected.filter((path) => path === target).length, count);
    t.assert.equal(
      inspected.filter((path) => path === directory).length,
      count,
    );
  }
  inspected.length = 0;
  for (const count of [1, 2]) {
    t.assert.deepEqual(await files.list("nested"), [
      { name: "file", kind: "file" },
    ]);
    t.assert.equal(
      inspected.filter((path) => path === directory).length,
      count,
    );
  }
  await fs.rename(box.path("nested"), box.path("saved"));
  await fs.symlink(outside.root, box.path("nested"), "junction");
  await t.assert.rejects(files.readText("nested/file"), /FS-LINK/);
  await t.assert.rejects(files.list("nested"), /FS-LINK/);
  t.assert.equal(await outside.read("file"), "outside bytes");
});

test("native file store completes disk work without queued filesystem requests", async (t) => {
  const box = await sandbox(t, { git: false });
  let queued = 0;
  const observer = createHook({
    init(_id, type) {
      if (type === "FSREQPROMISE" || type === "FSREQCALLBACK") queued++;
    },
  });
  let stored;
  t.plan(4);
  observer.enable();
  try {
    const files = await createFileStore(box.root);
    const update = files.writeText("nested/audit", "日本語\n");
    t.assert.equal(update instanceof Promise, true);
    t.assert.equal(await update, true);
    stored = await files.readText("nested/audit");
  } finally {
    observer.disable();
  }
  t.assert.equal(stored, "日本語\n");
  t.assert.equal(
    queued,
    0,
    "native CLI filesystem operations must not queue worker-pool requests",
  );
});

for (const failure of ["write", "sync", "close"]) {
  test(`${failure} failure preserves original contents and closes the owned handle`, async (t) => {
    const box = await sandbox(t, { git: false });
    await box.write("audit", "original");
    const error = new Error(`injected ${failure} failure`);
    /** @type {string[]} */ const steps = [];
    const files = await createFileStore(box.root, {
      ...fs,
      async open(path, flags, mode) {
        t.assert.deepEqual([flags, mode], ["wx", 0o600]);
        const handle = await fs.open(path, flags, mode);
        return {
          async writeFile(text, encoding) {
            steps.push("write");
            if (failure === "write") throw error;
            await handle.writeFile(text, encoding);
          },
          async sync() {
            steps.push("sync");
            if (failure === "sync") throw error;
            await handle.sync();
          },
          async close() {
            steps.push("close");
            await handle.close();
            if (failure === "close") throw error;
          },
        };
      },
    });
    t.plan(5);
    await t.assert.rejects(files.writeText("audit", "replacement"), error);
    t.assert.equal(await box.read("audit"), "original");
    t.assert.deepEqual(await fs.readdir(box.root), ["audit"]);
    t.assert.deepEqual(
      steps,
      failure === "write" ? ["write", "close"] : ["write", "sync", "close"],
    );
  });
}

test("file store rejects synchronous port errors through the public Promise API", async (t) => {
  const box = await sandbox(t, { git: false });
  const error = new Error("synchronous port error");
  const files = await createFileStore(box.root, {
    ...fs,
    mkdir() {
      throw error;
    },
  });
  t.plan(3);
  const update = files.writeText("audit", "new");
  t.assert.equal(update instanceof Promise, true);
  await t.assert.rejects(update, error);
  t.assert.deepEqual(await fs.readdir(box.root), []);
});

test("file store rechecks a target linked after temporary contents were flushed", async (t) => {
  const box = await sandbox(t, { git: false });
  const outside = await sandbox(t, { git: false });
  await box.write("audit", "original");
  await outside.write("protected", "outside");
  const files = await createFileStore(box.root, {
    ...fs,
    async open(path, flags, mode) {
      const handle = await fs.open(path, flags, mode);
      return {
        writeFile: (text, encoding) => handle.writeFile(text, encoding),
        sync: () => handle.sync(),
        async close() {
          await handle.close();
          await fs.unlink(box.path("audit"));
          await fs.link(outside.path("protected"), box.path("audit"));
        },
      };
    },
  });
  t.plan(4);
  await t.assert.rejects(files.writeText("audit", "replacement"), /FS-LINK/);
  t.assert.equal(await outside.read("protected"), "outside");
  t.assert.equal(await box.read("audit"), "outside");
  t.assert.deepEqual(await fs.readdir(box.root), ["audit"]);
});

test("native driver flushes and closes the same descriptor before completing replacement", async (t) => {
  const box = await sandbox(t, { git: false });
  const files = await createFileStore(box.root);
  const originalSync = native.fsyncSync;
  const originalClose = native.closeSync;
  /** @type {{step:string,descriptor:number}[]} */ const calls = [];
  native.fsyncSync = (descriptor) => {
    calls.push({ step: "sync", descriptor });
    originalSync(descriptor);
  };
  native.closeSync = (descriptor) => {
    calls.push({ step: "close", descriptor });
    originalClose(descriptor);
  };
  syncBuiltinESMExports();
  try {
    await files.writeText("audit", "durable");
  } finally {
    native.fsyncSync = originalSync;
    native.closeSync = originalClose;
    syncBuiltinESMExports();
  }
  t.plan(3);
  t.assert.deepEqual(
    calls.map((call) => call.step),
    ["sync", "close"],
  );
  t.assert.equal(calls[0]?.descriptor, calls[1]?.descriptor);
  t.assert.equal(await box.read("audit"), "durable");
});

test("file store retains a UTF-8 BOM as content through reading and rewriting", async (t) => {
  const box = await sandbox(t, { git: false });
  const text = "\uFEFF日本語\n";
  await box.write("audit", text);
  const files = await createFileStore(box.root);
  t.plan(3);
  t.assert.equal(await files.readText("audit"), text);
  t.assert.equal(
    await files.updateText("audit", (before) => `${before}next`),
    true,
  );
  t.assert.deepEqual(
    await fs.readFile(box.path("audit")),
    Buffer.from(`${text}next`),
  );
});

test("file store rejects reserved device names without rejecting their harmless suffixes", async (t) => {
  const box = await sandbox(t, { git: false });
  const files = await createFileStore(box.root);
  // Resolved paths are spelled from the canonical root, which the temp directory may alias.
  const base = native.realpathSync.native(box.root);
  const forbidden = ["COM1", "com9.dat", "LPT1", "lpt9.dat"];
  const allowed = ["recon.txt", "preCOM1.txt", "adapter-lpt9.dat"];
  t.plan(forbidden.length + allowed.length);
  for (const name of forbidden)
    await t.assert.rejects(files.resolvePath(name), /FS-PATH/);
  for (const name of allowed)
    t.assert.equal(await files.resolvePath(name), join(base, name));
});

test("file store does not swallow a non-Error port failure carrying an ENOENT property", async (t) => {
  const box = await sandbox(t, { git: false });
  const cause = { code: "ENOENT", reason: "not a filesystem Error" };
  const files = await createFileStore(box.root, {
    ...fs,
    lstat() {
      throw cause;
    },
  });
  t.plan(1);
  await t.assert.rejects(files.readText("missing"), (error) => error === cause);
});

test("native cleanup propagates errors other than a missing temporary file", async (t) => {
  const box = await sandbox(t, { git: false });
  const files = await createFileStore(box.root);
  const next = join(
    native.realpathSync.native(box.root),
    "audit.vouch-lock",
    "next",
  );
  const error = Object.assign(new Error("cleanup denied"), { code: "EACCES" });
  const originalUnlink = native.unlinkSync;
  native.unlinkSync = (path) => {
    if (path === next) throw error;
    originalUnlink(path);
  };
  syncBuiltinESMExports();
  t.plan(2);
  try {
    await t.assert.rejects(files.writeText("audit", "replaced"), error);
  } finally {
    native.unlinkSync = originalUnlink;
    syncBuiltinESMExports();
  }
  t.assert.equal(await box.read("audit"), "replaced");
});
