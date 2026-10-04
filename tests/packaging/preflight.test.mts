import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { probedPackage } from "../helpers/packaging-probe.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("packaging checks each path once per preflight and preserves all output bytes", async (t) => {
  const box = await sandbox(t);
  t.plan(5);
  t.assert.equal(packageRun(["--out", box.path("dist")]).status, 0);
  const before = tree(box.path("dist"));
  const result = probedPackage(box.root);
  const report: { hits: [string, number][] } = JSON.parse(
    await box.read("probe.json"),
  );
  t.assert.equal(result.status, 0, result.stderr);
  t.assert.equal(report.hits.length > 0, true);
  t.assert.deepEqual(
    report.hits.filter(([, count]) => count > 2),
    [],
    "source scan and final destination preflight only",
  );
  t.assert.deepEqual(tree(box.path("dist")), before);
});
