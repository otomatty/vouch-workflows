import { rm } from "node:fs/promises";
import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("check detects missing and edited files without repairing them", async (t) => {
  const box = await sandbox(t);
  const args = ["--out", box.path("dist")];
  t.plan(11);
  t.assert.equal(packageRun([...args, "--check"]).status, 1);
  await t.assert.rejects(box.read("dist/claude/.claude/settings.json"), {
    code: "ENOENT",
  });
  t.assert.equal(packageRun(args).status, 0);
  const original = tree(box.path("dist"));
  t.assert.equal(packageRun([...args, "--check"]).status, 0);
  t.assert.deepEqual(tree(box.path("dist")), original);
  await box.write("dist/claude/.claude/settings.json", "changed");
  t.assert.equal(packageRun([...args, "--check"]).status, 1);
  t.assert.equal(
    await box.read("dist/claude/.claude/settings.json"),
    "changed",
  );
  t.assert.equal(packageRun(args).status, 0);
  // Delete a single known generated file; sandbox owns recursive cleanup.
  const entry = "dist/claude/.claude/hooks/vouch-record-session-start.mjs";
  await rm(box.path(entry));
  t.assert.equal(packageRun([...args, "--check"]).status, 1);
  await t.assert.rejects(box.read(entry), { code: "ENOENT" });
  t.assert.equal(packageRun(args).status, 0);
});
