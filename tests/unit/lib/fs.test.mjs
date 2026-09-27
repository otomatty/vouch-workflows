import * as fs from "node:fs/promises";
import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
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
