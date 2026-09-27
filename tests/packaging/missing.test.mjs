import { rm } from "node:fs/promises";
import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("check preserves missing files until explicit regeneration restores the inventory", async (t) => {
  const box = await sandbox(t);
  const args = ["--out", box.path("dist")];
  t.plan(6);
  t.assert.equal(packageRun(args).status, 0);
  const original = tree(box.path("dist"));
  // Delete one known generated file; sandbox owns recursive cleanup.
  const entry = "dist/claude/.claude/hooks/vouch-record-session-start.mjs";
  await rm(box.path(entry));
  const changed = tree(box.path("dist"));
  t.assert.equal(packageRun([...args, "--check"]).status, 1);
  await t.assert.rejects(box.read(entry), { code: "ENOENT" });
  t.assert.deepEqual(tree(box.path("dist")), changed);
  t.assert.equal(packageRun(args).status, 0);
  t.assert.deepEqual(tree(box.path("dist")), original);
});
