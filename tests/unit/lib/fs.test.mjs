import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeSync,
} from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  createFileStore,
  descriptorWriter,
  readDescriptor,
} from "../../../core/hooks/lib/fs.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

test("file store writes atomically inside a canonical root", async (t) => {
  const box = await sandbox(t, { git: false });
  const files = await createFileStore(box.root);
  t.plan(8);
  t.assert.equal(await files.readText("missing"), null);
  t.assert.equal(await files.writeText("nested/file", "first"), true);
  t.assert.equal(await files.readText("nested/file"), "first");
  t.assert.equal(await files.writeText("nested/file", "first"), false);
  t.assert.equal(await files.updateText("nested/file", () => null), false);
  t.assert.equal(
    await files.updateText("nested/file", (text) => `${text}\nsecond`),
    true,
  );
  t.assert.equal(await box.read("nested/file"), "first\nsecond");
  t.assert.deepEqual(await fs.readdir(box.path("nested")), ["file"]);
});

test("file store rejects escapes, links, directories and occupied locks", async (t) => {
  const box = await sandbox(t, { git: false });
  const outside = await sandbox(t, { git: false });
  await box.write("original", "kept");
  await fs.link(box.path("original"), box.path("hardlink"));
  await fs.symlink(outside.root, box.path("junction"), "junction");
  const files = await createFileStore(box.root);
  const invalid = [
    "../escape",
    outside.root,
    "junction/file",
    "hardlink",
    "original",
    "bad\0name",
    "file:stream",
    "",
    "trailing.",
    "NUL.txt",
    "..",
  ];
  t.plan(invalid.length + 5);
  for (const path of invalid)
    await t.assert.rejects(files.resolvePath(path), /FS-/);
  await t.assert.rejects(files.readText("."), /FS-TYPE/);
  await fs.mkdir(box.path("locked.vouch-lock"));
  await t.assert.rejects(files.writeText("locked", "new"), /FS-BUSY/);
  t.assert.equal(
    (await fs.stat(box.path("locked.vouch-lock"))).isDirectory(),
    true,
  );
  t.assert.equal(await files.readText("locked"), null);
  await t.assert.rejects(createFileStore(box.path("original")), /FS-ROOT/);
});

test("file store maps every root and input spelling of an aliased directory to the canonical root", async (t) => {
  const box = await sandbox(t, { git: false });
  const other = await sandbox(t, { git: false });
  // A junction on Windows and a symbolic link elsewhere, like 8.3, subst and linked temp paths.
  const alias = other.path("alias");
  await fs.symlink(box.root, alias, "junction");
  const base = realpathSync.native(box.root);
  const spellings = [box.root, alias];
  t.plan(spellings.length ** 2 * 2 + 2);
  for (const root of spellings) {
    const files = await createFileStore(root);
    for (const input of spellings) {
      t.assert.equal(await files.resolvePath(input), base);
      t.assert.equal(
        await files.resolvePath(join(input, "nested", "file")),
        join(base, "nested", "file"),
      );
    }
  }
  const files = await createFileStore(box.root);
  t.assert.equal(
    await files.writeText(join(alias, "nested", "file"), "through alias"),
    true,
  );
  t.assert.equal(await box.read("nested/file"), "through alias");
});

test("file store classifies lexically contained paths without an alias lookup and the parent as an escape", async (t) => {
  const box = await sandbox(t, { git: false });
  const base = realpathSync.native(box.root);
  let lookups = 0;
  const files = await createFileStore(base, {
    ...fs,
    realpath: /** @type {typeof fs.realpath} */ (
      /** @type {unknown} */ (
        async (/** @type {string} */ path) => {
          lookups++;
          return fs.realpath(path);
        }
      )
    ),
  });
  const nested = join(base, "nested", "file");
  /** @type {[string, string][]} */
  const contained = [
    [".", base],
    ["nested/file", nested],
    [base, base],
    [nested, nested],
  ];
  t.plan(contained.length + 2);
  for (const [input, expected] of contained)
    t.assert.equal(await files.resolvePath(input), expected);
  t.assert.equal(lookups, 1, "only the root itself is canonicalized");
  await t.assert.rejects(files.resolvePath(".."), /FS-ESCAPE/);
});

test("file store keeps rejecting escapes, links and ambiguous names reached through a root alias", async (t) => {
  const box = await sandbox(t, { git: false });
  const other = await sandbox(t, { git: false });
  await box.write("original", "kept");
  await other.write("file.txt", "outside");
  await fs.link(box.path("original"), box.path("hardlink"));
  await fs.symlink(other.root, box.path("junction"), "junction");
  await fs.symlink(box.root, box.path("self"), "junction");
  await fs.symlink(other.root, other.path("elsewhere"), "junction");
  const alias = other.path("alias");
  await fs.symlink(box.root, alias, "junction");
  const files = await createFileStore(alias);
  /** @type {[string, RegExp][]} */
  const rejected = [
    [join(other.path("elsewhere"), "file"), /FS-ESCAPE/],
    [join(alias, "..", "file.txt"), /FS-ESCAPE/],
    [join(other.path("file.txt"), "child"), /FS-ESCAPE/],
    [join(other.path("missing"), "child"), /FS-ESCAPE/],
    [join(alias, "junction", "file"), /FS-LINK/],
    [join(alias, "self", "file"), /FS-LINK/],
    [join(box.root, "self", "file"), /FS-LINK/],
    [join(alias, "hardlink"), /FS-LINK/],
    [join(alias, "NUL.txt"), /FS-PATH/],
    [join(alias, "trailing."), /FS-PATH/],
    [`${join(alias, "file")}:stream`, /FS-PATH/],
  ];
  t.plan(rejected.length);
  for (const [path, error] of rejected)
    await t.assert.rejects(files.resolvePath(path), error);
});

test("file store propagates alias lookup failures other than a missing ancestor", async (t) => {
  const box = await sandbox(t, { git: false });
  const other = await sandbox(t, { git: false });
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  const primitive = { code: "ENOENT" };
  /** @param {unknown} failure */
  const failing = (failure) =>
    createFileStore(box.root, {
      ...fs,
      realpath: /** @type {typeof fs.realpath} */ (
        /** @type {unknown} */ (
          async (/** @type {string} */ path) => {
            if (path === box.root) return fs.realpath(path);
            throw failure;
          }
        )
      ),
    });
  t.plan(2);
  await t.assert.rejects(
    (await failing(denied)).resolvePath(other.path("x")),
    denied,
  );
  await t.assert.rejects(
    (await failing(primitive)).resolvePath(other.path("x")),
    (error) => error === primitive,
  );
});

test("filesystem errors retain their cause and do not acquire or remove locks", async (t) => {
  const box = await sandbox(t, { git: false });
  const error = Object.assign(new Error("denied"), { code: "EACCES" });
  const files = await createFileStore(box.root, {
    ...fs,
    mkdir: /** @type {typeof fs.mkdir} */ (
      async () => {
        throw error;
      }
    ),
  });
  const locked = await createFileStore(box.root, {
    ...fs,
    mkdir: /** @type {typeof fs.mkdir} */ (
      async (path, options) => {
        if (!options) throw error;
        return fs.mkdir(path, options);
      }
    ),
  });
  const special = await createFileStore(box.root, {
    ...fs,
    lstat: /** @type {typeof fs.lstat} */ (
      /** @type {unknown} */ (
        async () =>
          Object.assign(await fs.stat(box.root), {
            isSymbolicLink: () => false,
            isFile: () => false,
            isDirectory: () => false,
          })
      )
    ),
  });
  t.plan(4);
  await t.assert.rejects(files.writeText("audit", "data"), error);
  await t.assert.rejects(locked.writeText("audit", "data"), error);
  await t.assert.rejects(special.resolvePath("special"), /FS-TYPE/);
  t.assert.deepEqual(await fs.readdir(box.root), []);
});

test("file store refuses invalid UTF-8 instead of silently changing existing bytes", async (t) => {
  const box = await sandbox(t, { git: false });
  const files = await createFileStore(box.root);
  const original = Buffer.from([0x22, 0xff, 0x22, 0x0a]);
  await fs.writeFile(box.path("audit"), original);
  t.plan(2);
  await t.assert.rejects(
    files.updateText("audit", (before) => `${before}new`),
    /FS-ENCODING/,
  );
  t.assert.deepEqual(await fs.readFile(box.path("audit")), original);
});

test("failed update preserves the original and releases only its own lock", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("audit", "original");
  const files = await createFileStore(box.root, {
    ...fs,
    rename: async () => {
      throw new Error("simulated disk failure");
    },
  });
  t.plan(5);
  await t.assert.rejects(
    files.writeText("audit", "replacement"),
    /simulated disk failure/,
  );
  t.assert.equal(await box.read("audit"), "original");
  t.assert.deepEqual(await fs.readdir(box.root), ["audit"]);
  await t.assert.rejects(
    files.updateText("audit", () => {
      throw new Error("invalid batch");
    }),
    /invalid batch/,
  );
  t.assert.deepEqual(await fs.readdir(box.root), ["audit"]);
});

test("descriptor reader yields every byte until end of input and retries a refused read", async (t) => {
  const box = await sandbox(t, { git: false });
  const text = `${"日本語 input ".repeat(12000)}end`;
  await box.write("input", text);
  const refused = Object.assign(new Error("busy"), { code: "EAGAIN" });
  let refusals = 0;
  /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').DescriptorRead} */
  const flaky = (...args) => {
    if (refusals++ === 0) throw refused;
    return readSync(...args);
  };
  t.plan(4);
  for (const read of [undefined, flaky]) {
    const descriptor = openSync(box.path("input"), "r");
    try {
      const chunks = [...readDescriptor(descriptor, read)];
      t.assert.equal(Buffer.concat(chunks).toString("utf8"), text);
      t.assert.equal(chunks.length > 1, true, "larger than one buffer");
    } finally {
      closeSync(descriptor);
    }
  }
});

test("descriptor writer completes partial writes, retries a refused write and propagates other errors", async (t) => {
  const box = await sandbox(t, { git: false });
  const text = "VOUCH-REVIEW-RECORDED: 日本語 reason\n";
  const refused = Object.assign(new Error("busy"), { code: "EAGAIN" });
  const closed = Object.assign(new Error("closed"), { code: "EPIPE" });
  let calls = 0;
  /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').DescriptorWrite} */
  const partial = (descriptor, buffer, offset, length) => {
    if (calls++ === 1) throw refused;
    return writeSync(descriptor, buffer, offset, Math.min(length, 3));
  };
  t.plan(4);
  /** @type {[string, import('../../../core/hooks/lib/runtime-contracts.mjs').DescriptorWrite|undefined][]} */
  const writers = [
    ["native", undefined],
    ["partial", partial],
  ];
  for (const [name, write] of writers) {
    const descriptor = openSync(box.path(`${name}.log`), "w");
    try {
      descriptorWriter(descriptor, write).write(text);
    } finally {
      closeSync(descriptor);
    }
    t.assert.equal(readFileSync(box.path(`${name}.log`), "utf8"), text);
  }
  t.assert.equal(calls > text.length / 3, true, "several partial writes");
  t.assert.throws(
    () =>
      descriptorWriter(1, () => {
        throw closed;
      }).write("x"),
    closed,
  );
});
