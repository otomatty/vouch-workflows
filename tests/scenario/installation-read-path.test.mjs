import fs from "node:fs";
import { rename, symlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { commitChanges, readInside } from "../../scripts/lib/install-files.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("a replacement uses freshly verified existing parents and creates only missing parents", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("existing/file", "original");
  const original = fs.mkdirSync;
  /** @type {string[]} */ const directories = [];
  const mocked = t.mock.method(
    fs,
    "mkdirSync",
    (
      /** @type {import('node:fs').PathLike} */ path,
      /** @type {import('node:fs').MakeDirectoryOptions|import('node:fs').Mode|null|undefined} */ options = undefined,
    ) => {
      directories.push(String(path));
      return Reflect.apply(original, fs, [path, options]);
    },
  );
  syncBuiltinESMExports();
  try {
    commitChanges([
      {
        path: box.path("existing/file"),
        before: "original",
        after: "new bytes",
      },
    ]);
    t.assert.equal(await box.read("existing/file"), "new bytes");
    t.assert.deepEqual(directories, []);
    commitChanges([
      {
        path: box.path("new/deeper/file"),
        before: null,
        after: "created bytes",
      },
    ]);
    t.assert.equal(await box.read("new/deeper/file"), "created bytes");
    t.assert.deepEqual(directories, [box.path("new/deeper")]);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test("successful rename retains a temporary path reused by another writer while a failed rename cleans its own temporary", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("file", "original");
  const temporary = box.path(`file.vouch-install-${process.pid}`);
  const original = fs.renameSync;
  let fail = false;
  const failure = new Error("rename denied");
  const mocked = t.mock.method(
    fs,
    "renameSync",
    (
      /** @type {import('node:fs').PathLike} */ from,
      /** @type {import('node:fs').PathLike} */ to,
    ) => {
      if (fail) throw failure;
      original(from, to);
      fs.writeFileSync(from, "other writer's bytes", { flag: "wx" });
    },
  );
  syncBuiltinESMExports();
  try {
    commitChanges([
      { path: box.path("file"), before: "original", after: "new bytes" },
    ]);
    t.assert.equal(await box.read("file"), "new bytes");
    t.assert.equal(fs.readFileSync(temporary, "utf8"), "other writer's bytes");
    fs.rmSync(temporary);
    fail = true;
    t.assert.throws(
      () =>
        commitChanges([
          {
            path: box.path("file"),
            before: "new bytes",
            after: "failed bytes",
          },
        ]),
      (error) => error === failure,
    );
    t.assert.equal(await box.read("file"), "new bytes");
    t.assert.equal(fs.existsSync(temporary), false);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

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
