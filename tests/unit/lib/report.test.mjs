import { test } from "node:test";
import { runReport } from "../../../core/hooks/lib/report.mjs";
import {
  answered,
  asked,
  auditPath,
  defaulted,
  environment,
  git,
  intent,
  jsonl,
  project,
} from "../../helpers/resume.mjs";

/** @param {Record<string,string>} initial @param {string|null} [scope] */
async function report(initial, scope = intent) {
  const files = project(initial);
  const before = new Map(files.data);
  const result = await runReport(files, environment, git, { intent: scope });
  return {
    result,
    unchanged:
      [...before].every(([k, v]) => files.data.get(k) === v) &&
      before.size === files.data.size,
  };
}

const session = {
  id: "s-start",
  v: 1,
  type: "session.started",
  ts: "2026-09-30T00:00:00Z",
  actor: "hook",
  harness: "codex",
  intent,
  session: "s-1",
};

test("the report aggregates measured values per type and keeps missing and synthetic records apart", async (t) => {
  const open = asked("Q-1");
  const fallback = asked("Q-2");
  const settled = asked("Q-3");
  const { result, unchanged } = await report({
    "audit/events.jsonl": jsonl([
      session,
      open,
      fallback,
      defaulted(fallback),
      settled,
      { ...answered(settled, "A"), wait_ms: 7000 },
      {
        ...answered(settled, "B"),
        id: "synthetic",
        wait_ms: 1,
        synthetic: true,
      },
      {
        id: "check-1",
        v: 1,
        type: "hook.check",
        ts: "2026-09-30T00:00:01Z",
        actor: "hook",
        harness: "claude",
        tokens: { in: 10, out: 2 },
        check: "freshness",
        result: "pass",
        duration_ms: 40,
        stale: 1,
      },
      {
        id: "check-2",
        v: 1,
        type: "hook.check",
        ts: "2026-09-30T00:00:02Z",
        actor: "hook",
        check: "citation",
        result: "fail",
        duration_ms: 20,
      },
    ]),
  });
  const data =
    /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').AuditReport} */ (
      result.report
    );
  t.plan(9);
  t.assert.equal(unchanged, true, "the report never writes");
  t.assert.deepEqual(
    [result.ok, result.checks.map((item) => item.id)],
    [true, ["REPORT-SCOPE", "REPORT-AUDIT"]],
  );
  t.assert.deepEqual(
    [data.intent, data.path, data.events],
    [intent, auditPath, 9],
  );
  t.assert.deepEqual(data.types["question.answered"], {
    count: 2,
    synthetic: 1,
    estimated: 0,
    measures: {
      wait_ms: {
        n: 1,
        sum: 7000,
        min: 7000,
        max: 7000,
        missing: 0,
        examples: [answered(settled, "A").id],
      },
      "tokens.in": { n: 0, sum: 0, min: 0, max: 0, missing: 1, examples: [] },
      "tokens.out": { n: 0, sum: 0, min: 0, max: 0, missing: 1, examples: [] },
    },
  });
  t.assert.deepEqual(data.types["hook.check"]?.measures.duration_ms, {
    n: 2,
    sum: 60,
    min: 20,
    max: 40,
    missing: 0,
    examples: ["check-1", "check-2"],
  });
  t.assert.deepEqual(
    [
      data.types["hook.check"]?.measures.stale?.missing,
      data.types["hook.check"]?.measures.missing?.n,
      data.types["hook.check"]?.measures["tokens.in"]?.n,
    ],
    [1, 0, 1],
  );
  t.assert.deepEqual(data.types["question.asked"]?.measures.options?.sum, 6);
  t.assert.deepEqual(data.unpaired, {
    "question.asked": [open.id],
    "session.started": ["s-start"],
  });
  t.assert.equal("session.ended" in data.types, false);
});

test("damaged lines and repeated IDs make the report partial without hiding readable records", async (t) => {
  const open = asked("Q-1");
  const { result } = await report({
    "audit/events.jsonl": `${JSON.stringify(open)}\nbroken\n${JSON.stringify(open)}\n`,
  });
  t.plan(3);
  t.assert.equal(result.ok, false);
  t.assert.deepEqual(
    [result.report?.events, result.report?.invalid, result.report?.duplicates],
    [1, [2], [open.id]],
  );
  t.assert.match(
    result.checks.find((item) => item.id === "REPORT-AUDIT")?.detail ?? "",
    /invalid lines 2; duplicate IDs/,
  );
});

test("the report needs an explicit Intent and reports an empty log as zero records", async (t) => {
  const missing = await report({}, null);
  const empty = await report({});
  t.plan(4);
  t.assert.deepEqual(
    [missing.result.ok, missing.result.checks.map((item) => item.id)],
    [false, ["REPORT-SCOPE"]],
  );
  t.assert.equal(missing.result.report, undefined);
  t.assert.deepEqual(
    [empty.result.ok, empty.result.report?.events, empty.result.report?.types],
    [true, 0, {}],
  );
  t.assert.deepEqual(
    [empty.result.report?.legacy, empty.result.report?.shared_waits],
    [0, []],
  );
});

test("migrated records with derived times are counted as estimated and kept out of the measures", async (t) => {
  const start = {
    id: "m-start",
    v: 1,
    type: "stage.started",
    ts: "2025-06-15T10:40:00Z",
    actor: "hook",
    intent,
    stage: "intent",
    original_type: "STAGE_STARTED",
    raw: "## Stage Started",
    source_path: "aidlc/audit/a.md#L3",
  };
  const { result } = await report({
    "audit/events.jsonl": jsonl([
      start,
      {
        ...start,
        id: "m-end",
        type: "stage.completed",
        ts: "2025-06-16T09:00:00Z",
        parent: "m-start",
        duration_ms: 80400000,
        estimated: true,
        original_type: "STAGE_COMPLETED",
      },
      {
        id: "measured",
        v: 1,
        type: "stage.completed",
        ts: "2026-09-30T00:00:00Z",
        actor: "model",
        intent,
        stage: "design",
        parent: "m-start",
        duration_ms: 5,
      },
    ]),
  });
  const completed = result.report?.types["stage.completed"];
  t.plan(3);
  t.assert.equal(result.ok, true);
  t.assert.deepEqual(
    [completed?.count, completed?.synthetic, completed?.estimated],
    [2, 0, 1],
  );
  t.assert.deepEqual(completed?.measures.duration_ms, {
    n: 1,
    sum: 5,
    min: 5,
    max: 5,
    missing: 0,
    examples: ["measured"],
  });
});

test("a gate wait shared with intent.approved is excluded once, and legacy records stay out of the measures", async (t) => {
  const gate = {
    id: "gate-1",
    v: 1,
    type: "gate.opened",
    ts: "2026-09-30T00:00:00.000Z",
    actor: "hook",
    intent,
    source: "intent",
  };
  const { result } = await report({
    "audit/events.jsonl": jsonl([
      gate,
      {
        id: "approved",
        v: 1,
        type: "intent.approved",
        ts: "2026-09-30T00:00:02.000Z",
        actor: "human",
        intent,
        source: "intent",
        parent: gate.id,
        wait_ms: 4000,
      },
      {
        id: "shared-gate",
        v: 1,
        type: "gate.approved",
        ts: "2026-09-30T00:00:02.000Z",
        actor: "human",
        intent,
        source: "intent",
        parent: gate.id,
        wait_ms: 4000,
      },
      {
        id: "other-gate",
        v: 1,
        type: "gate.rejected",
        ts: "2026-09-30T00:00:03.000Z",
        actor: "human",
        intent,
        source: "pr",
        parent: "gate-2",
        wait_ms: 500,
        reason: "needs-work",
      },
      {
        id: "old",
        v: 1,
        type: "legacy.OLD",
        ts: "2026-09-30T00:00:00.000Z",
        actor: "hook",
        original_type: "OLD",
        raw: "old",
        source_path: "aidlc/audit/a.md#L1",
      },
    ]),
  });
  const data =
    /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').AuditReport} */ (
      result.report
    );
  t.plan(4);
  t.assert.deepEqual(data.shared_waits, ["shared-gate"]);
  t.assert.equal(data.legacy, 1);
  t.assert.deepEqual(data.types["gate.approved"]?.measures.wait_ms, {
    n: 0,
    sum: 0,
    min: 0,
    max: 0,
    missing: 0,
    examples: [],
    excluded: 1,
  });
  t.assert.deepEqual(
    [
      data.types["intent.approved"]?.measures.wait_ms?.sum,
      data.types["gate.rejected"]?.measures.wait_ms?.sum,
    ],
    [4000, 500],
  );
});
