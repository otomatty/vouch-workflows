import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import budgets from "../../core/registry/budgets.json" with { type: "json" };
import schema from "../../core/registry/budgets.schema.json" with {
  type: "json",
};

test("budgets satisfy the draft 2020-12 schema", (t) => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  t.plan(1);
  t.assert.equal(
    validate(budgets),
    true,
    `REG-5: ${JSON.stringify(validate.errors)}`,
  );
});

test("budgets reject an invalid coverage percentage", (t) => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const invalid = structuredClone(budgets);
  invalid.coverage.lib.branches = 101;
  t.plan(1);
  t.assert.equal(validate(invalid), false, "REG-5");
});

test("coding rules keep per-file limits and reject the retired aggregate lib cap", (t) => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  t.assert.equal(
    validate({ ...budgets, lines: { ...budgets.lines, libTotal: 4000 } }),
    false,
  );
  t.assert.equal(budgets.lines.libFile, 300);
  t.assert.equal(budgets.lines.hookFile, 150);
});
