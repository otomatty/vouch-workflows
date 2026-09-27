import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("check reports absent output and leaves matching output unchanged", async (t) => {
  const box = await sandbox(t);
  const args = ["--out", box.path("dist")];
  t.plan(5);
  t.assert.equal(packageRun([...args, "--check"]).status, 1);
  await t.assert.rejects(box.read("dist/claude/.claude/settings.json"), {
    code: "ENOENT",
  });
  t.assert.equal(packageRun(args).status, 0);
  const original = tree(box.path("dist"));
  t.assert.equal(packageRun([...args, "--check"]).status, 0);
  t.assert.deepEqual(tree(box.path("dist")), original);
});
