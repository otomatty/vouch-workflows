import { symlink } from "node:fs/promises";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { packageRun } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

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
