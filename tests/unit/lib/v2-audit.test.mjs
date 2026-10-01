import { readFileSync } from "node:fs";
import { test } from "node:test";
import { migratedOrigin } from "../../../core/hooks/lib/audit.mjs";
import { convertAudit, readShard } from "../../../core/hooks/lib/v2-audit.mjs";
import mapping from "../../../core/registry/audit-migration.json" with {
  type: "json",
};
import { handShard, intent, record } from "../../helpers/migrate.mjs";
import { validator } from "../../helpers/registry.mjs";

const validate = validator("audit-event");
const sample = readFileSync(
  "docs/aidlc-v2-reference/tests/fixtures/audit-sample.md",
  "utf8",
);
const samplePath = `${record}/audit/host-clone.md`;
const handPath = `${record}/audit/host-other.md`;
/** @type {Record<import('../../../core/hooks/lib/contracts.mjs').Stage,import('../../../core/hooks/lib/migration-contracts.mjs').StageObservation>} */
const progress = {
  intent: { state: "completed", stages: [] },
  design: { state: "active", stages: [] },
  build: { state: "pending", stages: [] },
  verify: { state: "absent", stages: [] },
};

test("shards split on separator lines into blocks with their own first line and fields", (t) => {
  const blocks = readShard(samplePath, sample);
  t.plan(4);
  t.assert.equal(blocks.length, 3, "the file title is not a record");
  t.assert.deepEqual(blocks[0], {
    path: samplePath,
    index: 1,
    line: 3,
    raw: "## Session Start\n**Timestamp**: 2025-06-15T10:30:00Z\n**Event**: SESSION_STARTED\n**Source**: startup",
    ts: "2025-06-15T10:30:00Z",
    name: "SESSION_STARTED",
    fields: {
      Timestamp: "2025-06-15T10:30:00Z",
      Event: "SESSION_STARTED",
      Source: "startup",
    },
  });
  t.assert.deepEqual(
    blocks.map((block) => [block.index, block.line, block.name]),
    [
      [1, 3, "SESSION_STARTED"],
      [2, 10, "ARTIFACT_CREATED"],
      [3, 19, "SUBAGENT_COMPLETED"],
    ],
  );
  t.assert.deepEqual(
    readShard(
      "x.md",
      "**Timestamp**: 2025-02-30T00:00:00Z\n**Event**: lower\r\n---\r\n\r\n",
    ).map((block) => [block.ts, block.name, block.raw]),
    [[null, null, "**Timestamp**: 2025-02-30T00:00:00Z\n**Event**: lower"]],
    "an impossible date and a nonconforming name are not kept as such; CRLF is normalized only for splitting",
  );
});

test("the audit sample and the hand-made shard convert only what can be restored", (t) => {
  const blocks = [
    ...readShard(samplePath, sample),
    ...readShard(handPath, handShard),
  ];
  const converted = convertAudit(blocks, intent, progress);
  const types = converted.events.map((event) => event.type);
  t.plan(11);
  t.assert.equal(converted.events.length, 13, "every block is one record");
  t.assert.deepEqual(types, [
    "legacy.SESSION_STARTED",
    "legacy.WORKFLOW_STARTED",
    "legacy.ARTIFACT_CREATED",
    "stage.started",
    "legacy.SUBAGENT_COMPLETED",
    "legacy.STAGE_STARTED",
    "legacy.GATE_APPROVED",
    "legacy.STAGE_COMPLETED",
    "stage.completed",
    "learn.recorded",
    "stage.started",
    "legacy.UNTYPED",
    "legacy.UNTYPED",
  ]);
  t.assert.equal(
    converted.events.every((event) => validate(event)),
    true,
    JSON.stringify(validate.errors),
  );
  const [started, completed, learned, design] = converted.events.filter(
    (event) => !event.type.startsWith("legacy."),
  );
  t.assert.deepEqual(
    [
      started?.stage,
      completed?.parent,
      completed?.duration_ms,
      completed && migratedOrigin(completed).estimated,
    ],
    ["intent", started?.id, 80400000, true],
    "the last completion of a completed stage closes its first start; the duration is estimated",
  );
  t.assert.deepEqual(
    [
      learned?.type,
      learned && "rules_added" in learned ? learned.rules_added : null,
    ],
    ["learn.recorded", 1],
  );
  t.assert.deepEqual(
    [
      design?.type,
      design?.stage,
      design?.ts,
      design && migratedOrigin(design).estimated,
    ],
    ["stage.started", "design", "2025-06-16T09:05:00Z", true],
    "a missing timestamp comes from the previous block of the same shard",
  );
  t.assert.deepEqual(
    converted.events.map((event) => [
      event.actor,
      event.intent,
      migratedOrigin(event).original_type,
      migratedOrigin(event).source_path?.split("#")[0],
    ])[0],
    ["hook", intent, "SESSION_STARTED", samplePath],
  );
  t.assert.deepEqual(
    converted.events
      .map(migratedOrigin)
      .filter((origin) => origin.original_type === "UNTYPED")
      .map((origin) => origin.source_path),
    [`${handPath}#L67`, `${handPath}#L76`],
  );
  t.assert.deepEqual(converted.decisions, [
    {
      id: converted.events[6]?.id,
      name: "GATE_APPROVED",
      ts: "2025-06-15T12:00:00Z",
      source_path: `${handPath}#L27`,
    },
  ]);
  t.assert.deepEqual(
    converted.types.map((type) => [
      type.name,
      type.count,
      type.to,
      type.converted,
      type.legacy,
      type.estimated,
    ]),
    [
      ["ARTIFACT_CREATED", 1, "legacy", 0, 1, 0],
      ["GATE_APPROVED", 1, "gate.approved", 0, 1, 0],
      ["RULE_LEARNED", 1, "learn.recorded", 1, 0, 0],
      ["SESSION_STARTED", 1, "session.started", 0, 1, 0],
      ["STAGE_COMPLETED", 2, "stage.completed", 1, 1, 1],
      ["STAGE_STARTED", 3, "stage.started", 2, 1, 1],
      ["SUBAGENT_COMPLETED", 1, "legacy", 0, 1, 0],
      ["UNTYPED", 2, "legacy", 0, 2, 0],
      ["WORKFLOW_STARTED", 1, "intent.created", 0, 1, 0],
    ],
  );
  t.assert.deepEqual(converted.problems, []);
});

test("conversion never infers approval, build counters or an unfinished stage's completion", (t) => {
  const shard = (/** @type {string[]} */ ...blocks) =>
    readShard(handPath, blocks.join("\n---\n"));
  /** @param {string} name @param {string} stage @param {string} ts */
  const block = (name, stage, ts) =>
    `## ${name}\n**Timestamp**: ${ts}\n**Event**: ${name}\n**Stage**: ${stage}\n`;
  const build = convertAudit(
    shard(
      block("STAGE_STARTED", "code-generation", "2025-06-15T10:00:00Z"),
      block("STAGE_COMPLETED", "ci-pipeline", "2025-06-15T11:00:00Z"),
      block("STAGE_STARTED", "operation-unknown", "2025-06-15T11:30:00Z"),
      block("STAGE_COMPLETED", "functional-design", "2025-06-15T12:00:00Z"),
      block("GATE_APPROVED", "approval-handoff", "2025-06-15T13:00:00Z"),
    ),
    intent,
    { ...progress, build: { state: "completed", stages: [] } },
  );
  t.plan(4);
  t.assert.deepEqual(
    build.events.map((event) => event.type),
    [
      "stage.started",
      "legacy.STAGE_COMPLETED",
      "legacy.STAGE_STARTED",
      "legacy.STAGE_COMPLETED",
      "legacy.GATE_APPROVED",
    ],
    "build lacks loop counters, an unknown stage has no mapping, design is not completed",
  );
  t.assert.equal(
    Object.values(mapping).includes("gate.approved") &&
      build.events.every((event) => event.type !== "gate.approved"),
    true,
  );
  const timeless = convertAudit(
    readShard(
      handPath,
      "## A\n**Event**: SESSION_STARTED\n---\n## B\n**Event**: SESSION_ENDED\n",
    ),
    intent,
    progress,
  );
  t.assert.deepEqual(
    [timeless.events.length, timeless.problems],
    [0, [`${handPath}: no valid timestamp`]],
  );
  const later = convertAudit(
    readShard(
      handPath,
      "## A\n**Event**: SESSION_STARTED\n---\n## B\n**Timestamp**: 2025-06-15T10:00:00Z\n**Event**: SESSION_ENDED\n",
    ),
    intent,
    progress,
  );
  t.assert.deepEqual(
    later.events.map((event) => [event.ts, migratedOrigin(event).estimated]),
    [
      ["2025-06-15T10:00:00Z", true],
      ["2025-06-15T10:00:00Z", undefined],
    ],
    "without an earlier time the next one is used",
  );
});

test("record identities are stable and bound to the source text", (t) => {
  const blocks = readShard(samplePath, sample);
  const first = convertAudit(blocks, intent, progress).events;
  const again = convertAudit(
    readShard(samplePath, sample),
    intent,
    progress,
  ).events;
  const changed = convertAudit(
    readShard(samplePath, sample.replace("startup", "resume")),
    intent,
    progress,
  ).events;
  t.plan(3);
  t.assert.deepEqual(again, first);
  t.assert.notEqual(changed[0]?.id, first[0]?.id);
  t.assert.equal(new Set(first.map((event) => event.id)).size, 3);
});
