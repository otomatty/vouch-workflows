import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

test("status evaluation inputs remain synthetic and unexecuted rather than harness evidence", (t) => {
  const suite = readJson("tests/eval/status/cases.json");
  t.plan(4 + suite.cases.length * 3);
  t.assert.equal(suite.synthetic, true);
  t.assert.equal(suite.execution, "not-run");
  t.assert.deepEqual(
    suite.cases.map((/** @type {{id:string}} */ c) => c.id),
    [
      "empty",
      "multiple",
      "default-and-reask",
      "inconsistent",
      "partial-log",
      "node-unavailable",
    ],
  );
  t.assert.equal(
    new Set(suite.cases.map((/** @type {{id:string}} */ c) => c.id)).size,
    suite.cases.length,
  );
  const validate = validator("audit-event");
  for (const c of suite.cases) {
    t.assert.equal(typeof c.prompt === "string" && c.prompt.length > 0, true);
    t.assert.equal(
      c.expect.length > 0 &&
        Object.values(c.files).every((text) => typeof text === "string"),
      true,
    );
    const records = Object.entries(c.files)
      .filter(([path]) => path.endsWith("events.jsonl"))
      .flatMap(([, text]) => String(text).trim().split("\n").filter(Boolean));
    const valid = records.every((line) => {
      try {
        const row = JSON.parse(line);
        return row.synthetic === true && validate(row);
      } catch {
        return false;
      }
    });
    t.assert.equal(
      valid,
      c.id !== "partial-log",
      "Data validation only; no model response has been evaluated",
    );
  }
});
