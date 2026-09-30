import { test } from "node:test";
import { readJson } from "../helpers/registry.mjs";

test("stage evaluation material is synthetic input rather than a model execution result", (t) => {
  const suite = readJson("tests/eval/stages/cases.json");
  const skills = Object.values(
    readJson("core/registry/stage-authoring.json").skills,
  );
  t.plan(5 + suite.cases.length * 3);
  t.assert.equal(suite.synthetic, true);
  t.assert.equal(suite.execution, "not-run");
  t.assert.deepEqual(
    suite.cases.map((/** @type {{id:string}} */ c) => c.id),
    [
      "design-high-risk",
      "build-unapproved",
      "build-approved",
      "build-default-answer",
      "verify-independent",
      "verify-round-limit",
      "learn-proposal",
    ],
  );
  t.assert.equal(
    new Set(suite.cases.map((/** @type {{id:string}} */ c) => c.id)).size,
    suite.cases.length,
  );
  t.assert.deepEqual(
    [
      ...new Set(suite.cases.map((/** @type {{skill:string}} */ c) => c.skill)),
    ].sort(),
    [...skills].sort(),
    "every stage Skill has evaluation input",
  );
  for (const c of suite.cases) {
    t.assert.equal(skills.includes(c.skill), true);
    t.assert.equal(
      typeof c.prompt === "string" &&
        c.prompt.length > 0 &&
        c.expect.length > 0 &&
        c.expect.every(
          (/** @type {unknown} */ value) =>
            typeof value === "string" && value.length > 0,
        ),
      true,
    );
    t.assert.equal(
      Object.entries(c.files).every(
        ([path, value]) =>
          !path.startsWith("/") &&
          !path.includes("..") &&
          typeof value === "string",
      ),
      true,
      "Input validation only; no Skill response or file mutation was evaluated",
    );
  }
});
