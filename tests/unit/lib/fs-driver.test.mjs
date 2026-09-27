import { createHook } from "node:async_hooks";
import * as fs from "node:fs/promises";
import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

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
    const steps = [];
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
