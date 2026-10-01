import { existsSync } from "node:fs";
import { source } from "../helpers/commands.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { where } from "../helpers/migrate.mjs";
import { validator } from "../helpers/registry.mjs";

// Planning and applying a real record run from the installed copy in tests/scenario/migrate-distribution.test.mjs.
test("the migrate command reports bad arguments and a missing record as JSON without writing", (t) => {
  const before = [existsSync("vouch"), existsSync("aidlc")];
  const results = [
    [source("vouch-migrate"), ["MIGRATE-ARGS"]],
    [source("vouch-migrate", ["copy", ...where]), ["MIGRATE-ARGS"]],
    [
      source("vouch-migrate", ["plan", ...where]),
      ["MIGRATE-ARGS", "MIGRATE-SOURCE"],
    ],
    [
      source("vouch-migrate", ["apply", ...where]),
      ["MIGRATE-ARGS", "MIGRATE-SOURCE"],
    ],
  ];
  t.plan(results.length * 4 + 1);
  for (const [
    result,
    ids,
  ] of /** @type {[import('node:child_process').SpawnSyncReturns<string>,string[]][]} */ (
    results
  )) {
    const report = JSON.parse(result.stdout);
    t.assert.equal(result.status, 2);
    t.assert.equal(result.stderr, "");
    t.assert.equal(validator("doctor-report")(report), true);
    t.assert.deepEqual(
      report.checks.map((/** @type {{id:string}} */ item) => item.id),
      ids,
    );
  }
  t.assert.deepEqual(
    [existsSync("vouch"), existsSync("aidlc")],
    before,
    "no project artifacts appear",
  );
});
