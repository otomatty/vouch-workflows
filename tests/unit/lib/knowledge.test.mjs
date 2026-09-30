import { test } from "node:test";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import {
  inspectKnowledge,
  inspectQuestions,
  inspectReferences,
} from "../../../core/hooks/lib/knowledge.mjs";
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
  files.data.set(paths[0], document.replace(date, "2026-09-28"));
  t.assert.match((await inspectKnowledge(ctx, head)).errors.join(), /stale/);
  files.data.delete(paths[1]);
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
    t.assert.ok((await inspectKnowledge(ctx, head)).errors.length);
  }
  const { files, ctx } = project();
  files.data.set("vouch/knowledge/index.json", "broken");
  t.assert.ok((await inspectKnowledge(ctx, null)).errors.length);
  for (const stamp of ["2026-02-30", "2026-13-01", "2026-09-28"]) {
    const index = JSON.parse(knowledgeFiles()["vouch/knowledge/index.json"]);
    index.entries[0].updated = stamp;
    files.data.set("vouch/knowledge/index.json", JSON.stringify(index));
    t.assert.ok((await inspectKnowledge(ctx, head)).errors.length);
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
    t.assert.ok(
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
  t.assert.ok(
    (await inspectReferences("# No sources", ctx, head, index)).length,
  );
  t.assert.ok(
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
    t.assert.ok(
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
  t.assert.ok((await inspectReferences(text, ctx, head, index)).length);
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
    t.assert.ok((await inspectReferences(text, ctx, head, index)).length);
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
    t.assert.ok((await inspectQuestions(bad, ctx, head, index)).length);
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
