import { readdirSync, readFileSync } from "node:fs";
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
        !Object.hasOwn(registry.events, target as string),
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

test("the migration registry is valid and classifies exactly the stages of the v2 state fixtures", (t) => {
  const migration = readJson("core/registry/migration.json");
  const fixtures = "docs/aidlc-v2-reference/tests/fixtures";
  const slugs = new Set(
    readdirSync(fixtures)
      .filter((name) => /^state-.+\.md$/.test(name))
      .flatMap((name) =>
        [
          ...readFileSync(`${fixtures}/${name}`, "utf8").matchAll(
            /^- \[.\] ([a-z][a-z0-9-]*) /gm,
          ),
        ].map((match) => match[1]),
      ),
  );
  const template = readFileSync(
    "docs/aidlc-v2-reference/core/knowledge/aidlc-shared/state-template.md",
    "utf8",
  );
  t.plan(5);
  t.assert.equal(
    validator("migration")(migration),
    true,
    JSON.stringify(validator("migration").errors),
  );
  t.assert.deepEqual(Object.keys(migration.stages).sort(), [...slugs].sort());
  t.assert.equal(slugs.size, 33, "33 v2 stages");
  t.assert.equal(
    [...template.matchAll(/^- \*\*([^*]+)\*\*:/gm)].some(
      (match) => match[1] === migration.affirmation.state,
    ),
    true,
    "the affirmation field is part of the v2 state template",
  );
  t.assert.deepEqual(
    Object.keys(migration.checkboxes)
      .map((mark) => `[${mark}]`)
      .sort(),
    [
      ...new Set(
        [
          ...readFileSync(
            "docs/aidlc-v2-reference/docs/reference/12-state-machine.md",
            "utf8",
          ).matchAll(/^\| `(\[.\])` \|/gm),
        ].map((match) => match[1]),
      ),
    ].sort(),
    "every checkbox of the v2 state machine",
  );
});

test("migration conversions and decision candidates name v2 events and restorable targets only", (t) => {
  const migration = readJson("core/registry/migration.json");
  const mapping = readJson("core/registry/audit-migration.json");
  t.plan(4);
  t.assert.deepEqual(
    migration.audit.convert.map((name: string) => mapping[name]),
    ["stage.started", "stage.completed", "learn.recorded"],
  );
  t.assert.equal(
    migration.audit.decisions.every((name: string) =>
      Object.hasOwn(mapping, name),
    ),
    true,
  );
  t.assert.equal(
    migration.audit.convert.includes("GATE_APPROVED"),
    false,
    "Intent approval is never inferred",
  );
  t.assert.equal(
    [...migration.record, ...migration.space].every(
      (rule: { match: string; contains?: string }) =>
        new RegExp(rule.match).source.length > 0 &&
        (rule.contains === undefined ||
          new RegExp(rule.contains, "m").source.length > 0),
    ),
    true,
  );
});

test("migration labels have the same keys in Japanese and English", (t) => {
  const { labels } = readJson("core/registry/migration.json");
  const keys = (value: unknown): string[] =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value).flatMap(([key, item]) => [
          key,
          ...keys(item).map((inner) => `${key}.${inner}`),
        ])
      : [];
  t.plan(2);
  t.assert.deepEqual(keys(labels.en), keys(labels.ja));
  t.assert.equal(labels.en.limit_items.length, labels.ja.limit_items.length);
});
