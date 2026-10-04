import { rm } from "node:fs/promises";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("check rejects missing files without repairing output", async (t) => {
  const box = await sandbox(t);
  const args = ["--out", box.path("dist")];
  t.plan(4);
  t.assert.equal(packageRun(args).status, 0);
  // Delete one known generated file; sandbox owns recursive cleanup.
  const entry = "dist/claude/.claude/hooks/vouch-record-session-start.mjs";
  await rm(box.path(entry));
  const changed = tree(box.path("dist"));
  t.assert.equal(packageRun([...args, "--check"]).status, 1);
  await t.assert.rejects(box.read(entry), { code: "ENOENT" });
  t.assert.deepEqual(tree(box.path("dist")), changed);
});
