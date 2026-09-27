import { rm, symlink } from "node:fs/promises";
import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("check detects missing, edited and extra files without repairing them", async (t) => {
  const box = await sandbox(t);
  const args = ["--out", box.path("dist")];
  t.plan(10);
  t.assert.equal(packageRun([...args, "--check"]).status, 1);
  await t.assert.rejects(box.read("dist/claude/.claude/settings.json"), {
    code: "ENOENT",
  });
  t.assert.equal(packageRun(args).status, 0);
  const original = tree(box.path("dist"));
  t.assert.equal(packageRun([...args, "--check"]).status, 0);
  t.assert.deepEqual(tree(box.path("dist")), original);
  await box.write("dist/claude/.claude/settings.json", "changed");
  await box.write("dist/extra.txt", "preserve");
  // Delete a single known generated file; the sandbox helper owns recursive cleanup.
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
});

test("generation rejects linked output directories before writing outside its root", async (t) => {
  const box = await sandbox(t);
  const outside = await sandbox(t);
  await symlink(outside.root, box.path("linked"), "junction");
  t.plan(4);
  for (const path of [box.path("linked"), box.path("linked/nested")]) {
    const result = packageRun(["--out", path]);
    t.assert.equal(result.status, 1);
    t.assert.match(result.stderr, /PACKAGE-LINK/);
  }
});
