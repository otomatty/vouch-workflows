import { test } from "node:test";
import { readJson } from "../helpers/registry.mjs";

test("Intent evaluation material is synthetic input rather than a model execution result", (t) => {
  const suite = readJson("tests/eval/intent/cases.json");
  t.plan(4 + suite.cases.length * 2);
  t.assert.equal(suite.synthetic, true);
  t.assert.equal(suite.execution, "not-run");
  t.assert.deepEqual(
    suite.cases.map((c: { id: string }) => c.id),
    [
      "new-feature",
      "brownfield",
      "existing-answer",
      "approved-input",
      "unsafe-target",
      "node-unavailable",
    ],
  );
  t.assert.equal(
    new Set(suite.cases.map((c: { id: string }) => c.id)).size,
    suite.cases.length,
  );
  for (const c of suite.cases) {
    t.assert.equal(
      typeof c.prompt === "string" &&
        c.prompt.length > 0 &&
        c.expect.length > 0 &&
        c.expect.every(
          (value: unknown) => typeof value === "string" && value.length > 0,
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
