import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import operations from "../../core/registry/operations.json" with {
  type: "json",
};
import { hookTest as test } from "../helpers/hook-test.mjs";
import { validator } from "../helpers/registry.mjs";

// Source entries resolve their project from their own location: this repository, which has no Intent.
/** @param {string} entry @param {string[]} [args] @param {Record<string,string>} [env] */
function source(entry, args = [], env = {}) {
  return spawnSync(
    process.execPath,
    [resolve(`core/hooks/${entry}.mjs`), ...args],
    {
      cwd: process.cwd(),
      input: "not a hook event",
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
      env: { ...process.env, VOUCH_INTENT: "", ...env },
    },
  );
}

test("the question and report commands report a missing Intent as JSON without writing", (t) => {
  const before = existsSync("vouch");
  const results = [
    [source("vouch-question", ["ask", "Q-1"]), "QUESTION-SCOPE"],
    [
      source("vouch-question", ["ask"], { VOUCH_INTENT: "260930-none" }),
      "QUESTION-ARGS",
    ],
    [source("vouch-report"), "REPORT-SCOPE"],
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

test("the statusline entry prints one line and exits zero with or without an Intent", (t) => {
  const unset = source("vouch-statusline");
  const invalid = source("vouch-statusline", [], { VOUCH_INTENT: "../x" });
  const absent = source("vouch-statusline", [], {
    VOUCH_INTENT: "260930-none",
  });
  t.plan(4);
  t.assert.deepEqual(
    [unset.status, unset.stdout, unset.stderr],
    [0, `Vouch: ${operations.labels.ja.unset}\n`, ""],
  );
  t.assert.match(invalid.stdout, /^Vouch: .+ \(AUDIT-SCOPE\)\n$/);
  t.assert.match(absent.stdout, /^Vouch 260930-none \| 確認 \? \| 未回答 0\n$/);
  t.assert.equal(existsSync("vouch/intents/260930-none"), false);
});
