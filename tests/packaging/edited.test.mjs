import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("check preserves edited files until explicit regeneration restores source bytes", async (t) => {
  const box = await sandbox(t);
  const args = ["--out", box.path("dist")];
  t.plan(6);
  t.assert.equal(packageRun(args).status, 0);
  const original = tree(box.path("dist"));
  await box.write("dist/claude/.claude/settings.json", "changed");
  const changed = tree(box.path("dist"));
  t.assert.equal(packageRun([...args, "--check"]).status, 1);
  t.assert.equal(
    await box.read("dist/claude/.claude/settings.json"),
    "changed",
  );
  t.assert.deepEqual(tree(box.path("dist")), changed);
  t.assert.equal(packageRun(args).status, 0);
  t.assert.deepEqual(tree(box.path("dist")), original);
});
