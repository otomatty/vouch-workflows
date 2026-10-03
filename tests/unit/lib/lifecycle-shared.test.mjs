import { test } from "node:test";
import {
  fail,
  harnessFields,
  harnessOf,
  last,
  live,
  recorded,
} from "../../../core/hooks/lib/lifecycle-shared.mjs";

test("live rows drop synthetic and estimated records", (t) => {
  /** @type {import('../../../core/hooks/lib/contracts.mjs').AuditEvent} */
  const synthetic = {
    id: "synthetic",
    v: 1,
    type: "gate.opened",
    ts: "2026-09-30T00:00:00.000Z",
    actor: "hook",
    intent: "one",
    source: "intent",
    synthetic: true,
  };
  /** @type {import('../../../core/hooks/lib/contracts.mjs').AuditEvent} */
  const estimated = {
    id: "estimated",
    v: 1,
    type: "stage.started",
    ts: "2026-09-30T00:00:00.000Z",
    actor: "hook",
    intent: "one",
    stage: "design",
    estimated: true,
    original_type: "STAGE_STARTED",
    raw: "stage",
    source_path: "aidlc/audit/a.md#L1",
  };
  /** @type {import('../../../core/hooks/lib/contracts.mjs').AuditEvent} */
  const kept = {
    id: "live",
    v: 1,
    type: "gate.opened",
    ts: "2026-09-30T00:00:00.000Z",
    actor: "hook",
    intent: "one",
    source: "pr",
  };
  t.plan(4);
  t.assert.equal(live(synthetic), false);
  t.assert.equal(live(estimated), false);
  t.assert.equal(live(kept), true);
  t.assert.equal(last([synthetic, estimated, kept], live)?.id, "live");
});

test("the harness name is the installation directory", (t) => {
  t.plan(6);
  t.assert.equal(harnessOf(".claude"), "claude");
  t.assert.equal(harnessOf("proj/.codex"), "codex");
  t.assert.equal(harnessOf("proj/.cursor"), "cursor");
  t.assert.equal(harnessOf("core"), null);
  t.assert.deepEqual(harnessFields("claude"), { harness: "claude" });
  t.assert.deepEqual(harnessFields(null), {});
});

test("command reports use the lifecycle check ids", (t) => {
  const refused = fail("LIFECYCLE-ARGS", "one token");
  const kept = recorded("evt");
  t.plan(4);
  t.assert.equal(refused.ok, false);
  t.assert.equal(refused.checks[0]?.id, "LIFECYCLE-ARGS");
  t.assert.equal(kept.ok, true);
  t.assert.equal(kept.checks[0]?.detail, "evt");
});
