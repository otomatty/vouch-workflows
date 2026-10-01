import { existsSync } from "node:fs";
import { source } from "../helpers/commands.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { validator } from "../helpers/registry.mjs";

// Recording runs are covered from the installed copy in tests/scenario/resume-distribution.test.mjs.
test("the question command reports a missing Intent or arguments as JSON without writing", (t) => {
  const before = existsSync("vouch");
  const results = [
    [source("vouch-question", ["ask", "Q-1"]), "QUESTION-SCOPE"],
    [
      source("vouch-question", ["ask"], { VOUCH_INTENT: "260930-none" }),
      "QUESTION-ARGS",
    ],
    [
      source("vouch-question", ["default", "Q-1"], {
        VOUCH_INTENT: "260930-none",
      }),
      "QUESTION-UNASKED",
    ],
  ];
  t.plan(results.length * 4 + 1);
  for (const [
    result,
    id,
  ] of /** @type {[import('node:child_process').SpawnSyncReturns<string>,string][]} */ (
    results
  )) {
    const report = JSON.parse(result.stdout);
    t.assert.equal(result.status, 2);
    t.assert.equal(result.stderr, "");
    t.assert.equal(validator("doctor-report")(report), true);
    t.assert.deepEqual(
      report.checks.map((/** @type {{id:string}} */ item) => item.id),
      [id],
    );
  }
  t.assert.equal(existsSync("vouch"), before, "no project artifacts appear");
});
