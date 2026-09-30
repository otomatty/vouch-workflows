import { test } from "node:test";

/** @param {import("node:test").TestContext} t @param {unknown} value @param {string} [message] */
const ok = (t, value, message) => t.assert.equal(Boolean(value), true, message);

import { inspectReferences } from "../../../core/hooks/lib/citation.mjs";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import { inspectKnowledge } from "../../../core/hooks/lib/freshness.mjs";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { inspectQuestions } from "../../../core/hooks/lib/questions.mjs";
import {
  artifact,
  citation,
  date,
  digest,
  document,
  head,
  knowledgeFiles,
  paths,
  question,
} from "../../helpers/knowledge.mjs";
import { memoryFiles, sandbox } from "../../helpers/runtime.mjs";

function project(initial = knowledgeFiles()) {
  const files = memoryFiles(initial);
  const ctx = {
    ...files,
    projectRoot: "/project",
    harness: /** @type {const} */ ("claude"),
    intent: "test",
    generation: "ignored",
    now: () => `${date}T12:00:00Z`,
    newId,
  };
  return { files, ctx };
}
test("freshness compares HEAD, document dates, digests and all mandatory layers", async (t) => {
  const { files, ctx } = project();
  t.assert.deepEqual((await inspectKnowledge(ctx, head)).errors, []);
  t.assert.match(
    (await inspectKnowledge(ctx, "b".repeat(40))).errors.join(),
    /generation/,
  );
  files.data.set(paths[0] ?? "", document.replace(date, "2026-09-28"));
  t.assert.match((await inspectKnowledge(ctx, head)).errors.join(), /stale/);
  files.data.delete(paths[1] ?? "");
  t.assert.match((await inspectKnowledge(ctx, head)).errors.join(), /missing/);
});
test("invalid manifests, dates, duplicate and misplaced entries cannot pass", async (t) => {
  for (const value of [
    null,
    {},
    { version: 1, generation: head, scope: "diff", entries: [] },
    JSON.parse(knowledgeFiles()["vouch/knowledge/index.json"]),
  ]) {
    const { files, ctx } = project();
    if (value?.entries?.length) value.entries.push(value.entries[0]);
    files.data.set("vouch/knowledge/index.json", JSON.stringify(value));
    ok(t, (await inspectKnowledge(ctx, head)).errors.length);
  }
  const { files, ctx } = project();
  files.data.set("vouch/knowledge/index.json", "broken");
  ok(t, (await inspectKnowledge(ctx, null)).errors.length);
  for (const stamp of ["2026-02-30", "2026-13-01", "2026-09-28"]) {
    const index = JSON.parse(knowledgeFiles()["vouch/knowledge/index.json"]);
    index.entries[0].updated = stamp;
    files.data.set("vouch/knowledge/index.json", JSON.stringify(index));
    ok(t, (await inspectKnowledge(ctx, head)).errors.length);
  }
});
test("citations verify local file, explicit section, line and pinned generation", async (t) => {
  const { ctx, files } = project();
  const index = (await inspectKnowledge(ctx, head)).index;
  t.assert.deepEqual(await inspectReferences(artifact, ctx, head, index), []);
  files.data.set("src/main.mjs", "one\ntwo\n");
  t.assert.deepEqual(
    await inspectReferences(
      `<!-- sec:references -->\n[code](src/main.mjs:2@${head})`,
      ctx,
      head,
      index,
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
test("citations reject traversal, absolute paths and links using the real filesystem boundary", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("doc.md", document);
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
test("real question cards require complete fields, two to four options and checked basis references", async (t) => {
  const { ctx } = project();
  const index = (await inspectKnowledge(ctx, head)).index;
  t.assert.deepEqual(await inspectQuestions(question, ctx, head, index), []);
  t.assert.deepEqual(
    await inspectQuestions("### Q-n: Unfilled", ctx, head, index),
    [],
  );
  for (const bad of [
    question.replace("Small", "未記入"),
    question.replace("A if unanswered.", ""),
    question.replaceAll(citation, "No evidence"),
    question.replace("<!-- question:recommendation -->", ""),
    question.replace(`| B | Broad | Complex | ${citation} |`, ""),
    question.replace(
      "<!-- question:default -->",
      "<!-- question:default -->\n<!-- question:default -->",
    ),
  ]) {
    ok(t, (await inspectQuestions(bad, ctx, head, index)).length);
  }
  t.assert.deepEqual(
    await inspectQuestions(
      question.replace(
        "A if unanswered.",
        "blocking: no executable default until U1 contract is decided.",
      ),
      ctx,
      head,
      index,
    ),
    [],
  );
});

test("knowledge schema and runtime agree on additional fields, types and array minimum", async (t) => {
  const invalid = [
    null,
    {},
    {
      ...JSON.parse(knowledgeFiles()["vouch/knowledge/index.json"]),
      extra: true,
    },
  ];
  for (const value of invalid) {
    const { files, ctx } = project();
    files.data.set("vouch/knowledge/index.json", JSON.stringify(value));
    t.assert.equal((await inspectKnowledge(ctx, head)).index, null);
  }
});
