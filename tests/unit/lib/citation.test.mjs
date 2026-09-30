import { symlink } from "node:fs/promises";
import { test } from "node:test";

/** @param {import("node:test").TestContext} t @param {unknown} value @param {string} [message] */
const ok = (t, value, message) => t.assert.equal(Boolean(value), true, message);

import { inspectReferences } from "../../../core/hooks/lib/citation.mjs";
import { inspectKnowledge } from "../../../core/hooks/lib/freshness.mjs";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import {
  artifact,
  date,
  digest,
  document,
  head,
  paths,
  knowledgeProject as project,
} from "../../helpers/knowledge.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

/** Read-only Git double; no child process in unit tests.
 * @param {Record<string,string|null>} [overrides] */
function committedGit(overrides = {}) {
  const answers = {
    [`ls-tree -z --full-tree ${head} -- :(literal)src/main.mjs`]: `100644 blob ${"f".repeat(40)}\tsrc/main.mjs\0`,
    [`show ${head}:src/main.mjs`]: "one\ntwo\n",
    ...overrides,
  };
  /** @type {string[][]} */ const calls = [];
  /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').GitPort} */
  const read = async (...args) => {
    calls.push(args);
    return answers[args.join(" ")] ?? null;
  };
  return { read, calls };
}

test("citations verify local file, explicit section, line and pinned generation", async (t) => {
  const { ctx, files } = project();
  const git = committedGit();
  const index = (await inspectKnowledge(ctx, head)).index;
  t.assert.deepEqual(await inspectReferences(artifact, ctx, head, index), []);
  files.data.set("src/main.mjs", "one\ntwo\n");
  t.assert.deepEqual(
    await inspectReferences(
      `<!-- sec:references -->\n[code](src/main.mjs:2@${head})`,
      ctx,
      head,
      index,
      false,
      git.read,
    ),
    [],
  );
  for (const target of [
    `src/main.mjs:3@${head}`,
    `src/main.mjs:1@${"b".repeat(40)}`,
    `missing.md#main@${date}`,
    `${paths[0]}#absent@${date}`,
    `${paths[0]}#main@2026-09-26`,
    "unversioned.md",
  ]) {
    ok(
      t,
      (
        await inspectReferences(
          `<!-- sec:references -->\n[bad](${target})`,
          ctx,
          head,
          index,
          false,
          git.read,
        )
      ).length,
      target,
    );
  }
  ok(t, (await inspectReferences("# No sources", ctx, head, index)).length);
  ok(
    t,
    (
      await inspectReferences(
        "<!-- sec:references -->\nNo links",
        ctx,
        head,
        index,
      )
    ).length,
  );
});

test("code citations check committed regular files and lines rather than worktree additions", async (t) => {
  const { ctx, files } = project();
  files.data.set("src/main.mjs", "one\ntwo\nthree\n");
  files.data.set("src/untracked.mjs", "untracked\n");
  const git = committedGit();
  const inspect = (/** @type {string} */ target) =>
    inspectReferences(`[x](${target})`, ctx, head, null, true, git.read);
  t.assert.deepEqual(await inspect(`src/main.mjs:2@${head}`), []);
  t.assert.equal((await inspect(`src/main.mjs:3@${head}`)).length > 0, true);
  t.assert.equal(
    (await inspect(`src/untracked.mjs:1@${head}`)).length > 0,
    true,
  );
  t.assert.deepEqual(git.calls[0], [
    "ls-tree",
    "-z",
    "--full-tree",
    head,
    "--",
    ":(literal)src/main.mjs",
  ]);
  t.assert.deepEqual(git.calls[1], ["show", `${head}:src/main.mjs`]);
  const before = git.calls.length;
  t.assert.equal(
    (await inspect(`src/main.mjs:1@${"b".repeat(40)}`)).length > 0,
    true,
  );
  t.assert.equal(
    git.calls.length,
    before,
    "stale SHA is refused before reading Git",
  );
  for (const overrides of [
    { [`ls-tree -z --full-tree ${head} -- :(literal)src/main.mjs`]: null },
    { [`ls-tree -z --full-tree ${head} -- :(literal)src/main.mjs`]: "" },
    {
      [`ls-tree -z --full-tree ${head} -- :(literal)src/main.mjs`]: `120000 blob ${"f".repeat(40)}\tsrc/main.mjs\0`,
    },
    {
      [`ls-tree -z --full-tree ${head} -- :(literal)src/main.mjs`]: `040000 tree ${"f".repeat(40)}\tsrc/main.mjs\0`,
    },
    { [`show ${head}:src/main.mjs`]: null },
  ]) {
    t.assert.equal(
      (
        await inspectReferences(
          `[x](src/main.mjs:1@${head})`,
          ctx,
          head,
          null,
          true,
          committedGit(overrides).read,
        )
      ).length > 0,
      true,
    );
  }
});

test("knowledge citations require an indexed path and matching bytes even through aliases or code syntax", async (t) => {
  const { ctx, files } = project();
  const index = (await inspectKnowledge(ctx, head)).index;
  files.data.set("vouch/knowledge/codekb/extra.md", document);
  files.data.set("./vouch/knowledge/codekb/extra.md", document);
  for (const target of [
    `vouch/knowledge/codekb/extra.md#main@${date}`,
    `./vouch/knowledge/codekb/extra.md#main@${date}`,
    `vouch/knowledge/codekb/extra.md:1@${head}`,
  ])
    t.assert.equal(
      (
        await inspectReferences(
          `[x](${target})`,
          ctx,
          head,
          index,
          true,
          committedGit().read,
        )
      ).length > 0,
      true,
    );
  const indexed = paths[0];
  if (!indexed) throw new Error("indexed knowledge fixture required");
  files.data.set(indexed, `${document}changed without updating the index\n`);
  t.assert.equal(
    (await inspectReferences(artifact, ctx, head, index)).length > 0,
    true,
  );
  files.data.set("ordinary.md", document);
  t.assert.deepEqual(
    await inspectReferences(
      `[x](ordinary.md#main@${date})`,
      ctx,
      head,
      index,
      true,
    ),
    [],
  );
  t.assert.equal(
    (await inspectReferences(artifact, ctx, head, null)).length > 0,
    true,
  );
});
test("citations reject traversal, absolute paths and links using the real filesystem boundary", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("doc.md", document);
  await symlink(box.path("doc.md"), box.path("linked.md"));
  const files = await createFileStore(box.root);
  const ctx = {
    ...project().ctx,
    readText: files.readText,
    locate: files.locate,
  };
  for (const target of [
    `../doc.md#main@${date}`,
    `${box.path("doc.md")}#main@${date}`,
    `C:/doc.md#main@${date}`,
    `linked.md#main@${date}`,
  ]) {
    ok(
      t,
      (
        await inspectReferences(
          `<!-- sec:references -->\n[x](${target})`,
          ctx,
          head,
          null,
        )
      ).length,
    );
  }
});
test("external URL checks use only local dated receipts and snapshot digests", async (t) => {
  const { ctx, files } = project();
  const index = (await inspectKnowledge(ctx, head)).index;
  const url = "https://example.com/docs#main";
  const text = `<!-- sec:references -->\n[official](${url})`;
  ok(t, (await inspectReferences(text, ctx, head, index)).length);
  files.data.set("snapshot.md", document);
  const receipt = {
    version: 1,
    records: [
      { url, checked: date, snapshot: "snapshot.md", sha256: digest(document) },
    ],
  };
  files.data.set("vouch/knowledge/external.json", JSON.stringify(receipt));
  t.assert.deepEqual(await inspectReferences(text, ctx, head, index), []);
  for (const change of [
    { checked: "2026-09-26" },
    { checked: "2026-09-28" },
    { sha256: "0".repeat(64) },
    { snapshot: "../escape" },
  ]) {
    files.data.set(
      "vouch/knowledge/external.json",
      JSON.stringify({
        ...receipt,
        records: [{ ...receipt.records[0], ...change }],
      }),
    );
    ok(t, (await inspectReferences(text, ctx, head, index)).length);
  }
});
