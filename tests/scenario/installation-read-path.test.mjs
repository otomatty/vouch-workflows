import fs from "node:fs";
import { rename, symlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { commitChanges, readInside } from "../../scripts/lib/install-files.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("a guarded installer read inspects the target once per operation without caching", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("directory/file", "original");
  const original = fs.lstatSync;
  /** @type {string[]} */ const queried = [];
  const mocked = t.mock.method(
    fs,
    "lstatSync",
    (
      /** @type {import('node:fs').PathLike} */ path,
      /** @type {import('node:fs').StatOptions|undefined} */ options = undefined,
    ) => {
      queried.push(String(path));
      return Reflect.apply(original, fs, [path, options]);
    },
  );
  syncBuiltinESMExports();
  try {
    for (const count of [1, 2]) {
      t.assert.equal(readInside(box.root, "directory/file"), "original");
      t.assert.equal(
        queried.filter((path) => path === box.path("directory/file")).length,
        count,
      );
      t.assert.equal(
        queried.filter((path) => path === box.path("directory")).length,
        count,
      );
    }
    t.assert.equal(readInside(box.root, "missing/deeper/file"), null);
    t.assert.equal(queried.includes(box.path("missing")), true);
    t.assert.equal(queried.includes(box.path("missing/deeper")), false);
    t.assert.equal(queried.includes(box.path("missing/deeper/file")), false);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test("fresh installer metadata still rejects an ancestor replaced by a junction", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("directory/file", "original");
  await box.write("outside/file", "outside");
  t.assert.equal(readInside(box.root, "directory/file"), "original");
  await rename(box.path("directory"), box.path("saved"));
  await symlink(box.path("outside"), box.path("directory"), "junction");
  t.assert.throws(() => readInside(box.root, "directory/file"), /INSTALL-LINK/);
  t.assert.throws(
    () =>
      commitChanges([
        {
          path: box.path("directory/file"),
          before: "outside",
          after: "changed",
        },
      ]),
    /INSTALL-LINK/,
  );
  t.assert.equal(await box.read("saved/file"), "original");
  t.assert.equal(await box.read("outside/file"), "outside");
});

test("installer metadata errors still propagate and replacement preserves permissions", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("file", "original");
  const target = box.path("file");
  const mode = fs.lstatSync(target).mode & 0o777;
  const original = fs.lstatSync;
  const failure = new Error("metadata denied");
  const mocked = t.mock.method(
    fs,
    "lstatSync",
    (
      /** @type {import('node:fs').PathLike} */ path,
      /** @type {import('node:fs').StatOptions|undefined} */ options = undefined,
    ) => {
      if (String(path) === target) throw failure;
      return Reflect.apply(original, fs, [path, options]);
    },
  );
  syncBuiltinESMExports();
  try {
    t.assert.throws(
      () => readInside(box.root, "file"),
      (error) => error === failure,
    );
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
  commitChanges([{ path: target, before: "original", after: "updated" }]);
  t.assert.equal(await box.read("file"), "updated");
  t.assert.equal(fs.lstatSync(target).mode & 0o777, mode);
});
