import { test } from "node:test";

const ok = (
  t: import("node:test").TestContext,
  value: unknown,
  message?: string,
) => t.assert.equal(Boolean(value), true, message);

import { inspectKnowledge } from "../../../core/hooks/lib/freshness.mjs";
import {
  date,
  document,
  head,
  knowledgeFiles,
  paths,
  knowledgeProject as project,
} from "../../helpers/knowledge.mjs";

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
