import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

// locate.mjs classifies spelled paths for the FileStore; these cases drive it through createFileStore.
test("file store locates spelled paths at their real place without refusing links or outside paths", async (t) => {
  const box = await sandbox(t, { git: false });
  const other = await sandbox(t, { git: false });
  await box.write("nested/file", "x");
  await box.write("nested/shared", "y");
  await fs.link(box.path("nested/shared"), box.path("nested/hard"));
  await fs.symlink(box.path("nested/file"), box.path("file-link"));
  await fs.symlink(box.path("nested"), box.path("dir-link"), "junction");
  await fs.symlink(other.path("elsewhere"), box.path("dangling"));
  await fs.symlink(box.path("loop-b"), box.path("loop-a"));
  await fs.symlink(box.path("loop-a"), box.path("loop-b"));
  await fs.symlink(box.root, other.path("alias"), "junction");
  await fs.symlink(box.path("nested/file"), other.path("inbound"));
  const files = await createFileStore(box.root);
  /** @type {[string, string|undefined, import('../../../core/hooks/lib/runtime-contracts.mjs').PathLocation][]} */
  const cases = [
    [
      "nested/file",
      undefined,
      { inside: "nested/file", contains: false, kind: "file", links: 1 },
    ],
    [
      "nested/hard",
      undefined,
      { inside: "nested/hard", contains: false, kind: "file", links: 2 },
    ],
    [
      "nested",
      undefined,
      { inside: "nested", contains: false, kind: "directory", links: 0 },
    ],
    [
      "a/b/c",
      undefined,
      { inside: "a/b/c", contains: false, kind: "missing", links: 0 },
    ],
    [
      "nested/file/child",
      undefined,
      {
        inside: "nested/file/child",
        contains: false,
        kind: "missing",
        links: 0,
      },
    ],
    [
      ".",
      undefined,
      { inside: "", contains: true, kind: "directory", links: 0 },
    ],
    [
      "..",
      undefined,
      {
        inside: null,
        outside: dirname(box.root),
        contains: true,
        kind: "directory",
        links: 0,
      },
    ],
    [
      other.path("x"),
      undefined,
      {
        inside: null,
        outside: other.path("x"),
        contains: false,
        kind: "missing",
        links: 0,
      },
    ],
    [
      "file-link",
      undefined,
      { inside: "nested/file", contains: false, kind: "file", links: 1 },
    ],
    [
      "dir-link/new/deeper",
      undefined,
      {
        inside: "nested/new/deeper",
        contains: false,
        kind: "missing",
        links: 0,
      },
    ],
    [
      "dangling",
      undefined,
      { inside: "dangling", contains: false, kind: "unresolved", links: 0 },
    ],
    [
      "loop-a",
      undefined,
      { inside: "loop-a", contains: false, kind: "unresolved", links: 0 },
    ],
    [
      join(other.path("alias"), "nested", "file"),
      undefined,
      { inside: "nested/file", contains: false, kind: "file", links: 1 },
    ],
    [
      other.path("inbound"),
      undefined,
      { inside: "nested/file", contains: false, kind: "file", links: 1 },
    ],
    [
      "file",
      box.path("nested"),
      { inside: "nested/file", contains: false, kind: "file", links: 1 },
    ],
    [
      "../nested/file",
      other.path("alias/dir-link"),
      { inside: "nested/file", contains: false, kind: "file", links: 1 },
    ],
    // A backslash separates only on Windows; elsewhere it is part of a name.
    [
      "nested\\file",
      undefined,
      process.platform === "win32"
        ? { inside: "nested/file", contains: false, kind: "file", links: 1 }
        : {
            inside: "nested\\file",
            contains: false,
            kind: "missing",
            links: 0,
          },
    ],
    [
      "bad\0name",
      undefined,
      { inside: "bad\0name", contains: false, kind: "missing", links: 0 },
    ],
  ];
  t.plan(cases.length + 1);
  for (const [path, from, expected] of cases)
    t.assert.deepEqual(await files.locate(path, from), expected, path);
  t.assert.equal(await box.read("nested/file"), "x", "locating never writes");
});

test("file store exposes the resolved external target for aliases and missing descendants", async (t) => {
  const box = await sandbox(t, { git: false });
  const other = await sandbox(t, { git: false });
  await other.write("runtime/file.mjs", "trusted");
  await fs.symlink(other.path("runtime"), box.path("selected"), "junction");
  const files = await createFileStore(box.root);
  t.assert.deepEqual(await files.locate("selected/file.mjs"), {
    inside: null,
    outside: other.path("runtime/file.mjs"),
    contains: false,
    kind: "file",
    links: 1,
  });
  t.assert.deepEqual(await files.locate("selected/new/file.mjs"), {
    inside: null,
    outside: other.path("runtime/new/file.mjs"),
    contains: false,
    kind: "missing",
    links: 0,
  });
});

test("file store locate reports other node types, a missing volume and components it cannot look up", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("device", "");
  const failure = Object.assign(new Error("denied"), { code: "EACCES" });
  const special = await createFileStore(box.root, {
    ...fs,
    stat: /** @type {typeof fs.stat} */ (
      /** @type {unknown} */ (
        async (/** @type {string} */ path) => {
          const info = await fs.stat(path);
          return path.endsWith("device")
            ? Object.assign(Object.create(info), {
                isFile: () => false,
                isDirectory: () => false,
              })
            : info;
        }
      )
    ),
  });
  const refusing = await createFileStore(box.root, {
    ...fs,
    lstat: /** @type {typeof fs.lstat} */ (
      /** @type {unknown} */ (
        async (/** @type {string} */ path) => {
          if (path.endsWith("blocked")) throw failure;
          return fs.lstat(path);
        }
      )
    ),
  });
  const empty = await createFileStore(box.root, {
    ...fs,
    lstat: /** @type {typeof fs.lstat} */ (
      /** @type {unknown} */ (
        async () => {
          throw Object.assign(new Error("gone"), { code: "ENOENT" });
        }
      )
    ),
  });
  t.plan(3);
  t.assert.deepEqual(await empty.locate("a/b"), {
    inside: "a/b",
    contains: false,
    kind: "missing",
    links: 0,
  });
  t.assert.deepEqual(await special.locate("device"), {
    inside: "device",
    contains: false,
    kind: "other",
    links: 0,
  });
  // A denied lookup counts as missing, so one word never fails a guard open.
  t.assert.deepEqual(await refusing.locate("blocked/file"), {
    inside: "blocked/file",
    contains: false,
    kind: "missing",
    links: 0,
  });
});

test("file store locate walks up from looping links and long names and reports targets it cannot examine", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("vouch/audit/events.jsonl", "x");
  await box.write("vanished", "x");
  await fs.symlink(box.path("loop-b"), box.path("loop-a"));
  await fs.symlink(box.path("loop-a"), box.path("loop-b"));
  await fs.symlink(box.path("missing/target"), box.path("dangling"));
  const long = "a".repeat(300);
  const gone = Object.assign(new Error("gone"), { code: "ENOENT" });
  const files = await createFileStore(box.root);
  const vanishing = await createFileStore(box.root, {
    ...fs,
    stat: /** @type {typeof fs.stat} */ (
      /** @type {unknown} */ (
        async (/** @type {string} */ path) => {
          if (path.endsWith("vanished")) throw gone;
          return fs.stat(path);
        }
      )
    ),
  });
  let broken = false;
  const unrooted = await createFileStore(box.root, {
    ...fs,
    realpath: /** @type {typeof fs.realpath} */ (
      /** @type {unknown} */ (
        async (/** @type {string} */ path) => {
          if (broken) throw gone;
          return fs.realpath(path);
        }
      )
    ),
  });
  broken = true;
  /** @param {string} inside @param {'missing'|'unresolved'} kind */
  const at = (inside, kind) => ({ inside, contains: false, kind, links: 0 });
  t.plan(5);
  t.assert.deepEqual(
    await files.locate("loop-a/x"),
    at("loop-a/x", "unresolved"),
  );
  t.assert.deepEqual(await files.locate(long), at(long, "missing"));
  t.assert.deepEqual(
    await files.locate(`vouch/audit/${long}/x`),
    at(`vouch/audit/${long}/x`, "missing"),
  );
  t.assert.deepEqual(
    await vanishing.locate("vanished"),
    at("vanished", "unresolved"),
  );
  t.assert.deepEqual(
    await unrooted.locate("dangling"),
    at("dangling", "unresolved"),
  );
});

test("file store locate reads a backslash as the platform does", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("vouch/audit/events.jsonl", "x");
  const files = await createFileStore(box.root);
  const windows = process.platform === "win32";
  t.plan(2);
  t.assert.deepEqual(await files.locate("vouch\\audit\\events.jsonl"), {
    inside: windows ? "vouch/audit/events.jsonl" : "vouch\\audit\\events.jsonl",
    contains: false,
    kind: windows ? "file" : "missing",
    links: windows ? 1 : 0,
  });
  t.assert.deepEqual(await files.locate("vouch/audit/..\\x"), {
    inside: windows ? "vouch/x" : "vouch/audit/..\\x",
    contains: false,
    kind: "missing",
    links: 0,
  });
});
