import { link } from "node:fs/promises";
import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import {
  bytesAt,
  decoded,
  findConflicts,
  listed,
  observeArtifacts,
  readSources,
  verifyCopies,
} from "../../../core/hooks/lib/migrate-files.mjs";
import { archive, home, record, space } from "../../helpers/migrate.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

/** @param {import('node:test').TestContext} t @param {Record<string,string|Buffer>} files */
async function store(t, files) {
  const box = await sandbox(t, { git: false });
  for (const [path, text] of Object.entries(files))
    await box.write(path, /** @type {string} */ (text));
  return { box, files: await createFileStore(box.root) };
}

test("sources are every regular file of the record and the space's codekb and memory", async (t) => {
  const { box, files } = await store(t, {
    [`${record}/b.md`]: "b",
    [`${record}/a/c.md`]: "c",
    [`${space}/memory/team.md`]: "team",
    [`${space}/knowledge/other.md`]: "not a migration source",
    [`${record}/bad.bin`]: Buffer.from([0xff]),
  });
  await link(box.path(`${record}/b.md`), box.path(`${record}/twin.md`));
  const read = await readSources(files, record, space);
  t.plan(4);
  t.assert.deepEqual(
    read?.sources.map((item) => [item.origin, item.scope, item.text]),
    [
      ["a/c.md", "record", "c"],
      ["bad.bin", "record", null],
      ["memory/team.md", "space", "team"],
    ],
  );
  t.assert.deepEqual(read?.refused, [`${record}/b.md`, `${record}/twin.md`]);
  t.assert.equal(read?.recorded, 2, "regular record files found by the walk");
  t.assert.equal(await readSources(files, `${record}/missing`, space), null);
});

test("unreadable listings and files are refused, never followed or guessed", async (t) => {
  const { files } = await store(t, { [`${record}/x.md`]: "x" });
  const refusing = {
    ...files,
    /** @param {string} path */
    list: async (path) => {
      if (path.endsWith("/sub")) throw new Error("FS-PATH: reserved");
      return path === record
        ? [
            { name: "sub", kind: /** @type {const} */ ("directory") },
            { name: "x.md", kind: /** @type {const} */ ("file") },
            { name: "pipe", kind: /** @type {const} */ ("other") },
          ]
        : null;
    },
  };
  const read = await readSources(refusing, record, space);
  t.plan(5);
  t.assert.deepEqual(read?.refused, [`${record}/sub`, `${record}/pipe`]);
  t.assert.equal(
    await readSources(
      { ...files, list: async () => Promise.reject(new Error("FS-TYPE")) },
      record,
      space,
    ),
    null,
  );
  t.assert.equal(await bytesAt(files, "../escape"), undefined);
  t.assert.equal(decoded(Buffer.from([0xc3])), null);
  t.assert.equal(
    listed(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]),
    "a, b, c, d, e, f, g, h and 2 more",
  );
});

test("artifacts report the single raw status, and unreadable targets conflict", async (t) => {
  const { box, files } = await store(t, {
    [`${home}/intent.md`]: "---\nstatus: draft\nstatus: approved\n---\n",
    [`${home}/design.md`]: "---\r\nstatus: draft\r\n---\r\n",
    [`${home}/audit/events.jsonl`]: "broken\n",
    [`${home}/migration.md`]: "x",
  });
  await box.write("vouch/archive/aidlc-v2/source.md", "a");
  await link(
    box.path("vouch/archive/aidlc-v2/source.md"),
    box.path("vouch/archive/aidlc-v2/linked.md"),
  );
  const artifacts = await observeArtifacts(files, home, [
    "intent.md",
    "design.md",
    "review.md",
  ]);
  const conflicts = await findConflicts(files, {
    home,
    migrated: [
      {
        path: "source.md",
        origin: "source.md",
        bytes: 1,
        sha256: "0".repeat(64),
        archive: "vouch/archive/aidlc-v2/linked.md",
        to: [],
      },
    ],
    events: [],
    artifacts,
    current: undefined,
    brief: Buffer.from("x"),
  });
  t.plan(2);
  t.assert.deepEqual(
    artifacts.map((item) => [item.present, item.status]),
    [
      [true, null],
      [true, "draft"],
      [false, null],
    ],
  );
  t.assert.deepEqual(conflicts, [
    "vouch/archive/aidlc-v2/linked.md",
    `${home}/audit/events.jsonl: unreadable, invalid or repeated records`,
    `${home}/migration.md`,
  ]);
});

test("copies are verified against both the source and the archive", async (t) => {
  const { files } = await store(t, {
    "a.md": "a",
    [archive("a.md")]: "a",
    "b.md": "b",
    [archive("b.md")]: "changed",
  });
  const sha =
    "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";
  t.plan(1);
  t.assert.deepEqual(
    await verifyCopies(files, [
      {
        path: "a.md",
        origin: "a.md",
        bytes: 1,
        sha256: sha,
        archive: archive("a.md"),
        to: [],
      },
      {
        path: "b.md",
        origin: "b.md",
        bytes: 1,
        sha256:
          "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
        archive: archive("b.md"),
        to: [],
      },
      {
        path: "c.md",
        origin: "c.md",
        bytes: 1,
        sha256: sha,
        archive: archive("c.md"),
        to: [],
      },
    ]),
    ["b.md", "c.md"],
  );
});

test("a listed file that cannot be read and an unreadable audit log are refused", async (t) => {
  const { box, files } = await store(t, { [`${record}/x.md`]: "x" });
  await box.write(
    `${home}/audit/events.jsonl/inner`,
    "a directory where the log belongs",
  );
  const vanishing = {
    ...files,
    readBytes: async () => Promise.reject(new Error("FS-LINK: raced")),
  };
  const read = await readSources(vanishing, record, space);
  t.plan(2);
  t.assert.deepEqual([read?.sources, read?.refused], [[], [`${record}/x.md`]]);
  t.assert.deepEqual(
    await findConflicts(files, {
      home,
      migrated: [],
      events: [],
      artifacts: [],
      current: Buffer.from("x"),
      brief: Buffer.from("x"),
    }),
    [`${home}/audit/events.jsonl: unreadable, invalid or repeated records`],
  );
});
