import { hookTest as test } from "../helpers/hook-test.mjs";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("check rejects edited files without changing any output", async (t) => {
  const box = await sandbox(t);
  const args = ["--out", box.path("dist")];
  t.plan(4);
  t.assert.equal(packageRun(args).status, 0);
  await box.write("dist/claude/.claude/settings.json", "changed");
  const changed = tree(box.path("dist"));
  t.assert.equal(packageRun([...args, "--check"]).status, 1);
  t.assert.equal(
    await box.read("dist/claude/.claude/settings.json"),
    "changed",
  );
  t.assert.deepEqual(tree(box.path("dist")), changed);
});
