import fs from "node:fs";
import { rename, symlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  commitChanges,
  files,
  readInside,
} from "../../scripts/lib/install-files.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("tree reads reject an enumerated directory replaced by a file", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("source/original", "original bytes");
  fs.mkdirSync(box.path("source/empty"));
  const original = fs.readdirSync;
  const mocked = t.mock.method(
    fs,
    "readdirSync",
    (
      /** @type {import('node:fs').PathLike} */ path,
      /** @type {Parameters<typeof fs.readdirSync>[1]|undefined} */ options = undefined,
    ) => {
      const result = Reflect.apply(original, fs, [path, options]);
      if (String(path) === box.path("source")) {
        fs.rmdirSync(box.path("source/empty"));
        fs.writeFileSync(box.path("source/empty"), "replacement bytes");
      }
      return result;
    },
  );
  syncBuiltinESMExports();
  try {
    t.assert.throws(() => files(box.path("source")), /INSTALL-TYPE/);
    t.assert.equal(await box.read("source/empty"), "replacement bytes");
    t.assert.equal(await box.read("source/original"), "original bytes");
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test("tree reads validate their root once, then fresh canonical paths and file metadata without repeating ancestor probes", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("source/a", "a bytes");
  await box.write("source/b", "b bytes");
  const original = fs.lstatSync;
  let roots = 0;
  const mocked = t.mock.method(
    fs,
    "lstatSync",
    (
      /** @type {import('node:fs').PathLike} */ path,
      /** @type {import('node:fs').StatOptions|undefined} */ options = undefined,
    ) => {
      if (String(path) === box.path("source")) roots++;
      return Reflect.apply(original, fs, [path, options]);
    },
  );
  syncBuiltinESMExports();
  try {
    t.assert.deepEqual(files(box.path("source")), {
      a: "a bytes",
      b: "b bytes",
    });
    t.assert.equal(roots, 1);
    files(box.path("source"));
    t.assert.equal(roots, 2);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

for (const ancestor of [false, true])
  test(`tree reads reject a link introduced after the first file (ancestor=${ancestor})`, async (t) => {
    const box = await sandbox(t, { git: false });
    await box.write("parent/source/a", "original a");
    await box.write("parent/source/b", "original b");
    await box.write("outside/source/a", "outside bytes");
    await box.write("outside/source/b", "outside bytes");
    const original = fs.readFileSync;
    let replaced = false;
    const mocked = t.mock.method(
      fs,
      "readFileSync",
      (
        /** @type {import('node:fs').PathOrFileDescriptor} */ path,
        /** @type {Parameters<typeof fs.readFileSync>[1]} */ options = undefined,
      ) => {
        const result = Reflect.apply(original, fs, [path, options]);
        if (
          !replaced &&
          [box.path("parent/source/a"), box.path("parent/source/b")].includes(
            String(path),
          )
        ) {
          replaced = true;
          const other =
            String(path) === box.path("parent/source/a") ? "b" : "a";
          if (ancestor) {
            fs.renameSync(box.path("parent"), box.path("saved-parent"));
            fs.symlinkSync(box.path("outside"), box.path("parent"), "junction");
          } else {
            fs.renameSync(
              box.path(`parent/source/${other}`),
              box.path("saved-b"),
            );
            fs.symlinkSync(
              box.path(`outside/source/${other}`),
              box.path(`parent/source/${other}`),
            );
          }
        }
        return result;
      },
    );
    syncBuiltinESMExports();
    try {
      t.assert.throws(() => files(box.path("parent/source")), /INSTALL-LINK/);
      t.assert.equal(replaced, true);
      t.assert.equal(await box.read("outside/source/b"), "outside bytes");
    } finally {
      mocked.mock.restore();
      syncBuiltinESMExports();
    }
  });

test("tree reads reject hard links and retain strict UTF-8 byte validation", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("outside", "outside bytes");
  await box.write("source/file", "original");
  fs.rmSync(box.path("source/file"));
  fs.linkSync(box.path("outside"), box.path("source/file"));
  t.assert.throws(() => files(box.path("source")), /INSTALL-LINK/);
  t.assert.equal(await box.read("outside"), "outside bytes");
  fs.rmSync(box.path("source/file"));
  fs.writeFileSync(box.path("source/file"), Buffer.from([0xff]));
  t.assert.throws(() => files(box.path("source")), TypeError);
  fs.writeFileSync(
    box.path("source/file"),
    Buffer.from([0xef, 0xbb, 0xbf, 0x61]),
  );
  t.assert.throws(() => files(box.path("source")), /INSTALL-ENCODING/);
});

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
