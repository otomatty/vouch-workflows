import { rm } from "node:fs/promises";
import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("extra files and invalid arguments stop generation before any partial repair", async (t) => {
  const box = await sandbox(t);
  const args = ["--out", box.path("dist")];
  t.plan(7);
  t.assert.equal(packageRun(args).status, 0);
  await box.write("dist/extra.txt", "preserve");
  await rm(
    box.path("dist/claude/.claude/hooks/vouch-record-session-start.mjs"),
  );
  const changed = tree(box.path("dist"));
  t.assert.equal(packageRun([...args, "--check"]).status, 1);
  t.assert.deepEqual(tree(box.path("dist")), changed);
  t.assert.equal(
    packageRun(args).status,
    1,
    "unexpected output must not be silently deleted",
  );
  t.assert.deepEqual(tree(box.path("dist")), changed);
  t.assert.equal(packageRun(["--unknown", ...args]).status, 1);
  t.assert.deepEqual(tree(box.path("dist")), changed);
});
