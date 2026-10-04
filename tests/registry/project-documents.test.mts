import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

test("project documents preserve stage artifacts and bilingual rules sections", (t) => {
  const data = readJson("core/registry/project-documents.json");
  const workflow = readJson("core/registry/workflow.json");
  const validate = validator("project-documents");
  t.plan(7);
  t.assert.equal(validate(data), true, JSON.stringify(validate.errors));
  t.assert.deepEqual(Object.keys(data.artifacts), workflow.stages);
  t.assert.deepEqual(data.artifacts, {
    intent: "intent.md",
    design: "design.md",
    build: "build-log.md",
    verify: "review.md",
  });
  t.assert.deepEqual(
    [data.decisions, data.audit],
    ["decisions.md", "audit/events.jsonl"],
  );
  t.assert.deepEqual(data.rules_sections, [
    "configuration",
    "dod",
    "restrictions",
    "dependencies",
    "checkpoints",
    "corrections",
  ]);
  t.assert.deepEqual(
    data.policy_rules,
    Array.from({ length: 7 }, (_, i) => `R-PROJECT-${i + 1}`),
  );
  t.assert.equal(validate({ ...data, state_machine: {} }), false);
});

test("rules frontmatter accepts workflow choices and rejects invented defaults", (t) => {
  const workflow = readJson("core/registry/workflow.json");
  const validate = validator("rules-frontmatter");
  const invalid = [
    { language: "fr", checkpoints: "topic" },
    { language: "ja", checkpoints: "automatic" },
    { language: "ja" },
    { checkpoints: "topic" },
    { language: "ja", checkpoints: "topic", auto_merge: true },
  ];
  t.plan(
    workflow.languages.length * workflow.checkpoint_modes.length +
      invalid.length,
  );
  for (const language of workflow.languages)
    for (const checkpoints of workflow.checkpoint_modes)
      t.assert.equal(validate({ language, checkpoints }), true);
  for (const data of invalid) t.assert.equal(validate(data), false);
});

test("project guardrails cite decisions without claiming pending enforcement as implemented", (t) => {
  const data = readJson("core/registry/project-documents.json");
  const map = readJson("core/registry/enforcement-map.json");
  t.plan(data.policy_rules.length * 3);
  for (const tag of data.policy_rules) {
    const row = map.rules[tag];
    t.assert.equal(row?.rule_id, tag.replace(/^R-/, ""));
    t.assert.match(
      row?.source ?? "",
      /^docs\/spec\/vouch-decision-record\.html#s\d+$/,
    );
    t.assert.equal(
      row?.checks.some(
        (check: { status: string }) => check.status === "pending",
      ),
      true,
    );
  }
});
