import { existsSync } from "node:fs";
import { source } from "../helpers/commands.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { validator } from "../helpers/registry.mjs";

test("the report command needs an explicit Intent and reports an absent log as zero records", (t) => {
  const before = existsSync("vouch");
  const missing = source("vouch-report");
  const empty = source("vouch-report", [], { VOUCH_INTENT: "260930-none" });
  const report = JSON.parse(empty.stdout);
  t.plan(5);
  t.assert.deepEqual(
    [missing.status, JSON.parse(missing.stdout).checks[0].id],
    [2, "REPORT-SCOPE"],
  );
  t.assert.deepEqual([empty.status, empty.stderr], [0, ""]);
  t.assert.equal(validator("doctor-report")(report), true);
  t.assert.deepEqual([report.report.events, report.report.types], [0, {}]);
  t.assert.equal(existsSync("vouch"), before, "the report never writes");
});
