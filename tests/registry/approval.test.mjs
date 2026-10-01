import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

// docs/development/approval-boundary.md: plan grammar, topic targets and Build artifacts.
test("the approval registry has a closed schema", (t) => {
  const valid = validator("approval");
  const registry = readJson("core/registry/approval.json");
  const cases = [
    { ...registry, extra: true },
    { ...registry, rules: "rules.md" },
    { ...registry, plan: { ...registry.plan, risks: ["L", "M"] } },
    { ...registry, plan: { ...registry.plan, unit: ".*" } },
    {
      ...registry,
      plan: { ...registry.plan, design: { required: "yes", skipped: "no" } },
    },
    { ...registry, topics: { ...registry.topics, units: "units" } },
    { ...registry, design_units: "plan" },
    { ...registry, build: ["build"] },
  ];
  t.plan(cases.length + 1);
  t.assert.equal(valid(registry), true);
  for (const value of cases) t.assert.equal(valid(value), false);
});

test("approval targets agree with the workflow, authoring, documents and command registries", (t) => {
  const approval = readJson("core/registry/approval.json");
  const workflow = readJson("core/registry/workflow.json");
  const authoring = readJson("core/registry/intent-authoring.json");
  const documents = readJson("core/registry/project-documents.json");
  const commands = readJson("core/registry/intent-review.json");
  const quality = readJson("core/registry/quality-layers.json");
  const stages = readJson("core/registry/stage-authoring.json");
  const unit = approval.plan.unit
    .replace(/^\^/, "")
    .replace("(?![\\s\\S])", "");
  const section = "[a-z][a-z-]{0,63}";
  t.plan(11);
  t.assert.deepEqual(
    Object.keys(approval.topics),
    workflow.topic_checkpoints
      .filter((/** @type {{when:string}} */ item) => item.when === "always")
      .map((/** @type {{id:string}} */ item) => item.id),
  );
  t.assert.equal(
    workflow.topic_checkpoints.some(
      (/** @type {{id:string,when:string}} */ item) =>
        item.id === "design" && item.when === "design-required",
    ),
    true,
  );
  t.assert.equal(
    Object.values(approval.topics).every((id) =>
      authoring.intent_sections.includes(id),
    ),
    true,
  );
  t.assert.equal(
    authoring.intent_sections.includes(approval.plan.section),
    true,
  );
  t.assert.equal(
    approval.build.every((/** @type {string} */ stage) =>
      Object.hasOwn(documents.artifacts, stage),
    ),
    true,
  );
  t.assert.equal(commands.targetPattern.includes(`unit (${unit})`), true);
  // Open questions Q2 B / C: design.md is confirmed per Unit row or per design section.
  t.assert.equal(stages.design_sections.includes(approval.design_units), true);
  t.assert.equal(
    commands.targetPattern.includes(`|design unit (${unit})`),
    true,
  );
  t.assert.equal(
    commands.targetPattern.includes(`|design section (${section})`),
    true,
  );
  t.assert.deepEqual(
    [...commands.targetPattern.matchAll(/\(([a-z|]+)\)\|unit/g)].map(
      (m) => m[1],
    ),
    [[...Object.keys(approval.topics), "design"].join("|")],
  );
  t.assert.deepEqual(approval.plan.risks, Object.keys(quality.sabotage));
});
