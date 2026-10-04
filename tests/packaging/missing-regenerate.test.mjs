import { rm } from "node:fs/promises";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("explicit regeneration restores every byte after an output file is missing", async (t) => {
  const box = await sandbox(t);
  const args = ["--out", box.path("dist")];
  t.plan(3);
  t.assert.equal(packageRun(args).status, 0);
  const original = tree(box.path("dist"));
  await rm(
    box.path("dist/claude/.claude/hooks/vouch-record-session-start.mjs"),
  );
  t.assert.equal(packageRun(args).status, 0);
  t.assert.deepEqual(tree(box.path("dist")), original);
});
