import { test } from "node:test";
import { validator } from "../../helpers/registry.mjs";

const validateReport = validator("doctor-report");
const validateAudit = validator("audit-event");

export type MigrationReport =
  import("../../../core/hooks/lib/migration-contracts.mjs").MigrationReport;
export type AuditEvent =
  import("../../../core/hooks/lib/contracts.mjs").AuditEvent;

test("JSDoc migration examples also satisfy the wire schemas", (t) => {
  const stage = { state: "absent" as const, stages: [] };
  const report: MigrationReport = {
    v: 1,
    ok: true,
    checks: [{ id: "MIGRATE-ARGS", ok: true, detail: "plan" }],
    migration: {
      source: "aidlc/spaces/default/intents/250615-widget",
      intent: "250615-widget",
      language: "ja",
      files: [
        {
          path: "aidlc/spaces/default/intents/250615-widget/runtime-graph.json",
          origin: "runtime-graph.json",
          bytes: 3,
          sha256: "a".repeat(64),
          archive:
            "vouch/archive/aidlc-v2/aidlc/spaces/default/intents/250615-widget/runtime-graph.json",
          to: [],
          note: "transient",
        },
      ],
      progress: { intent: stage, design: stage, build: stage, verify: stage },
      units: [],
      audit: { blocks: 0, converted: 0, legacy: 0, estimated: 0, types: [] },
      decisions: [],
      affirmation: null,
      codekb: [],
      artifacts: [
        {
          path: "vouch/intents/250615-widget/intent.md",
          present: false,
          status: null,
        },
      ],
      brief: { path: "vouch/intents/250615-widget/migration.md", sha256: null },
    },
  };
  const legacy: AuditEvent = {
    id: "evt_1",
    v: 1,
    type: "legacy.SWARM_STARTED",
    ts: "2025-06-15T10:00:00Z",
    actor: "hook",
    intent: "250615-widget",
    original_type: "SWARM_STARTED",
    raw: "## Swarm",
    source_path: "aidlc/a.md#L1",
    estimated: true,
  };
  t.plan(3);
  t.assert.equal(
    validateReport(report),
    true,
    JSON.stringify(validateReport.errors),
  );
  t.assert.equal(
    validateAudit(legacy),
    true,
    JSON.stringify(validateAudit.errors),
  );
  t.assert.equal(
    validateAudit({
      ...legacy,
      type: "stage.started",
      stage: "intent",
      original_type: undefined,
    }),
    false,
    "a migrated record keeps its original type",
  );
});
