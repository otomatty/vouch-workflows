import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  checkBudgetMs,
  testTimeoutFor,
} from "../../scripts/lib/time-budgets.mjs";

// Distinct values show which key each choice reads.
const timing = {
  testTimeoutMs: 5,
  testFileTimeoutMs: 70,
  checkTimeoutMs: { default: 900, win32: 1500 },
};

test("check budget uses the Windows value on win32 and the default elsewhere", (t) => {
  t.assert.equal(checkBudgetMs(timing, "win32"), 1500);
  t.assert.equal(checkBudgetMs(timing, "linux"), 900);
  t.assert.equal(checkBudgetMs(timing, "darwin"), 900);
  t.assert.equal(
    checkBudgetMs({ ...timing, checkTimeoutMs: { default: 900 } }, "win32"),
    900,
  );
});

test("hooks and scenario files get the file limit and other tiers the case limit", (t) => {
  t.assert.equal(testTimeoutFor("hooks", timing), 70);
  t.assert.equal(testTimeoutFor("scenario", timing), 70);
  for (const suite of ["checks", "packaging", "unit"])
    t.assert.equal(testTimeoutFor(suite, timing), 5, suite);
});

test("each runner reads its intended budget and never the other one", (t) => {
  const source = (file: string) => readFileSync(file, "utf8");
  const check = source("scripts/check.mjs");
  t.assert.match(check, /checkBudgetMs\(budgets\.timing\)/);
  t.assert.doesNotMatch(check, /testFileTimeoutMs|checkTimeoutMs/);
  for (const file of ["scripts/test.mjs", "scripts/benchmark-suite.mjs"]) {
    t.assert.match(source(file), /testTimeoutFor\(/, file);
    t.assert.doesNotMatch(source(file), /checkTimeoutMs|checkBudgetMs/, file);
  }
  const worker = source("tests/helpers/load-worker.mjs");
  t.assert.match(worker, /budgets\.timing\.testFileTimeoutMs/);
  t.assert.doesNotMatch(worker, /checkTimeoutMs|checkBudgetMs/);
});
