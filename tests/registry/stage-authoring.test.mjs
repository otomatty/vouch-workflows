import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

test("stage authoring registry satisfies its closed schema and rejects altered Briefs", (t) => {
  const data = readJson("core/registry/stage-authoring.json");
  const validate = validator("stage-authoring");
  t.plan(7);
  t.assert.equal(validate(data), true, JSON.stringify(validate.errors));
  t.assert.equal(validate({ ...data, state_machine: {} }), false, "REG-1");
  t.assert.equal(
    validate({ ...data, review_sections: [...data.review_sections, "extra"] }),
    false,
    "Decision §14: exactly nine Brief sections",
  );
  t.assert.equal(
    validate({ ...data, design_sections: ["summary", "summary"] }),
    false,
  );
  t.assert.equal(
    validate({ ...data, design_frontmatter: { status: "approved" } }),
    false,
    "R-PROJECT-1: a new design is a draft",
  );
  t.assert.equal(
    validate({ ...data, evidence: ["test", "log"] }),
    false,
    "Decision §7: evidence formats",
  );
  t.assert.equal(validate({ ...data, review_rounds: 0 }), false);
});

test("stage Skills map one-to-one to the four workflow stages without a new state", (t) => {
  const data = readJson("core/registry/stage-authoring.json");
  const workflow = readJson("core/registry/workflow.json");
  const authoring = readJson("core/registry/intent-authoring.json");
  t.plan(3);
  t.assert.deepEqual(workflow.stages, ["intent", "design", "build", "verify"]);
  t.assert.deepEqual(
    Object.keys(data.skills),
    workflow.stages.filter((/** @type {string} */ s) => s !== "intent"),
  );
  t.assert.equal(
    Object.values(data.skills).includes(authoring.skill),
    false,
    "Intent authoring keeps its own registry",
  );
});

test("Brief deferred, default and unresolved entries are sections six, seven and eight", (t) => {
  const data = readJson("core/registry/stage-authoring.json");
  t.plan(4);
  t.assert.equal(data.review_sections.length, 9, "Decision §14");
  t.assert.equal(data.review_sections[5], data.brief.deferred, "§6");
  t.assert.equal(data.review_sections[6], data.brief.defaults, "§7");
  t.assert.equal(data.review_sections[7], data.brief.unresolved, "§8");
});

test("every stage artifact keeps a references section and build DoD records stay last", (t) => {
  const data = readJson("core/registry/stage-authoring.json");
  t.plan(4);
  for (const key of ["design_sections", "build_sections", "review_sections"])
    t.assert.equal(data[key].includes("references"), true, `${key}`);
  t.assert.equal(data.build_sections.at(-1), "dod", "vouch-dod.mjs appends");
});

test("diff colour diagrams and Skill git commands stay within existing canon", (t) => {
  const data = readJson("core/registry/stage-authoring.json");
  const diagrams = readJson("core/registry/diagrams.json");
  const build = readJson("core/registry/build.json");
  t.plan(4);
  t.assert.equal(
    data.diff_kinds.every((/** @type {string} */ k) =>
      diagrams.mermaid.includes(k),
    ),
    true,
    "Decision §18 Q4",
  );
  t.assert.deepEqual(Object.keys(diagrams.diff), [
    "added",
    "changed",
    "removed",
  ]);
  t.assert.equal(
    data.git.includes("push") && build.protected.includes("main"),
    true,
    "push stays subject to the Git guard",
  );
  t.assert.equal(data.review_rounds >= 1, true, "Decision §5: bounded");
});
