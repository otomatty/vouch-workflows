import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

test("migration preserves the original taxonomy fixture byte for byte", (t) => {
  t.plan(1);
  t.assert.deepEqual(
    readFileSync("tests/fixtures/v2/audit-format.md"),
    readFileSync(
      "docs/aidlc-v2-reference/core/knowledge/aidlc-shared/audit-format.md",
    ),
    "REG-3: original source",
  );
});

test("migration covers all 91 v2 names with valid destinations", (t) => {
  const source = readFileSync("tests/fixtures/v2/audit-format.md", "utf8");
  const names = [
    ...source.matchAll(/^\|\s*(?:✓\s*)?`([A-Z][A-Z0-9_]+)`\s*\|/gm),
  ].map((m) => m[1]);
  const mapping = readJson("core/registry/audit-migration.json");
  const registry = readJson("core/registry/audit-events.json");
  t.plan(5);
  t.assert.equal(names.length, 91, "REG-3: source count");
  t.assert.equal(new Set(names).size, 91, "REG-3: unique names");
  t.assert.deepEqual(
    Object.keys(mapping).sort(),
    names.sort(),
    "REG-3: exact source keys",
  );
  t.assert.equal(validator("audit-migration")(mapping), true, "REG-3: schema");
  t.assert.deepEqual(
    Object.entries(mapping).filter(
      ([, target]) =>
        target !== "legacy" &&
        !Object.hasOwn(registry.events, /** @type {string} */ (target)),
    ),
    [],
    "REG-3: destinations",
  );
});

test("migration maps retained concepts and archives removed features", (t) => {
  const mapping = readJson("core/registry/audit-migration.json");
  const cases = {
    WORKFLOW_STARTED: "intent.created",
    WORKFLOW_COMPLETED: "intent.completed",
    STAGE_STARTED: "stage.started",
    STAGE_COMPLETED: "stage.completed",
    GATE_APPROVED: "gate.approved",
    DECISION_RECORDED: "question.asked",
    ARTIFACT_UPDATED: "knowledge.refreshed",
    SENSOR_PASSED: "hook.check",
    SENSOR_FAILED: "hook.check",
    RULE_LEARNED: "learn.recorded",
    SWARM_STARTED: "legacy",
    WORKTREE_CREATED: "legacy",
    BOLT_STARTED: "legacy",
    PLAN_APPROVAL_RECORDED: "legacy",
  };
  t.plan(Object.keys(cases).length);
  for (const [name, target] of Object.entries(cases))
    t.assert.equal(mapping[name], target, `REG-3: ${name}`);
});
