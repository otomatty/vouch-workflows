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

test("check budget is an OS table with a default and the test file limit is a separate key", (t) => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const timing = budgets.timing;
  const variant = (change: Record<string, unknown>) => ({
    ...budgets,
    timing: { ...timing, ...change },
  });
  const withoutFile = Object.fromEntries(
    Object.entries(timing).filter(([key]) => key !== "testFileTimeoutMs"),
  );
  t.assert.equal(validate(variant({ checkTimeoutMs: 90000 })), false);
  t.assert.equal(
    validate(variant({ checkTimeoutMs: { win32: 150000 } })),
    false,
  );
  t.assert.equal(
    validate(
      variant({ checkTimeoutMs: { ...timing.checkTimeoutMs, sunos: 1 } }),
    ),
    false,
  );
  t.assert.equal(validate({ ...budgets, timing: withoutFile }), false);
});

test("time budgets match the owner decision recorded for issue 28", (t) => {
  // docs/development/check-budget.md; TEST-12 and HOOK-13 limits stay as specified.
  t.assert.deepEqual(budgets.timing.checkTimeoutMs, {
    default: 90000,
    win32: 150000,
  });
  t.assert.equal(budgets.timing.testFileTimeoutMs, 90000);
  t.assert.equal(budgets.timing.testTimeoutMs, 5000);
  t.assert.equal(budgets.timing.recordP95Ms, 200);
  t.assert.equal(budgets.timing.samples, 20);
});
