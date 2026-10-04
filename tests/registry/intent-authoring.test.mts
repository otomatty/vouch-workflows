import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

test("Intent authoring registry preserves draft boundaries and decision-record limits", (t) => {
  const data = readJson("core/registry/intent-authoring.json");
  const validate = validator("intent-authoring");
  t.plan(8);
  t.assert.equal(validate(data), true, JSON.stringify(validate.errors));
  t.assert.equal(data.skill, "vouch-intent");
  t.assert.deepEqual(data.draft_frontmatter, { status: "draft" });
  t.assert.equal(
    data.unit_guideline,
    5,
    "Decision §6: guideline, not a hard limit",
  );
  t.assert.deepEqual(data.question_options, { min: 2, max: 4 }, "Decision §10");
  t.assert.equal(
    validate({ ...data, intent_sections: ["summary", "summary"] }),
    false,
  );
  t.assert.equal(
    validate({ ...data, question_options: { min: 2, max: 5 } }),
    false,
  );
  t.assert.equal(validate({ ...data, state_machine: {} }), false);
});

test("new Intent draft metadata rejects approval claims without redefining historical states", (t) => {
  const validate = validator("intent-draft-frontmatter");
  const invalid = [
    {},
    null,
    { status: "approved" },
    { status: "completed" },
    { status: 1 },
    { status: "draft", approved_by: "human" },
  ];
  t.plan(1 + invalid.length);
  t.assert.equal(validate({ status: "draft" }), true);
  for (const value of invalid) t.assert.equal(validate(value), false);
});
