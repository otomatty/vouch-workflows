import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex", "cursor"])
  for (const scope of ["project", "user"])
    test(`${harness}/${scope}: scoped changes reject a different stored scope or harness and preserve ownership`, async (t) => {
      const box = await sandbox(t);
      distribution(t, box);
      const installed = installRun("install", box, harness, scope);
      t.assert.equal(installed.status, 0, installed.stdout);
      const root = scope === "project" ? "project" : "home";
      const statePath = `${root}/.vouch/installations/${harness}.json`;
      const state = await box.read(statePath);
      const before = tree(box.path(root));
      const opposite = scope === "project" ? "user" : "project";
      for (const command of ["remove", "update", "install"]) {
        const result = installRun(command, box, harness, opposite, [
          scope === "project" ? "--home" : "--project",
          box.path(root),
        ]);
        t.assert.equal(result.status, 2, result.stdout);
        t.assert.match(result.stdout, /INSTALL-STATE/);
        t.assert.deepEqual(tree(box.path(root)), before);
      }
      const altered = {
        ...JSON.parse(state),
        harness: harness === "cursor" ? "claude" : "cursor",
      };
      await box.write(statePath, JSON.stringify(altered));
      const mismatched = tree(box.path(root));
      for (const command of ["remove", "update", "install", "init"]) {
        const result = installRun(command, box, harness, scope);
        t.assert.equal(result.status, 2, result.stdout);
        t.assert.match(result.stdout, /INSTALL-STATE/);
        t.assert.deepEqual(tree(box.path(root)), mismatched);
      }
      await box.write(statePath, state);
      const removed = installRun("remove", box, harness, scope);
      t.assert.equal(removed.status, 0, removed.stdout);
      await t.assert.rejects(box.read(statePath), { code: "ENOENT" });
    });

test("project binding changes reject another scope or harness before either scope changes", async (t) => {
  const box = await sandbox(t);
  distribution(t, box);
  t.assert.equal(installRun("install", box, "cursor", "user").status, 0);
  t.assert.equal(installRun("init", box, "cursor", "user").status, 0);
  const path = "project/.vouch/bindings/cursor.json";
  const binding = await box.read(path);
  for (const identity of [{ scope: "project" }, { harness: "claude" }]) {
    await box.write(
      path,
      JSON.stringify({ ...JSON.parse(binding), ...identity }),
    );
    const before = tree(box.root);
    for (const { command, scope } of [
      { command: "remove", scope: "project" },
      { command: "install", scope: "project" },
      { command: "init", scope: "project" },
      { command: "remove", scope: "user" },
    ]) {
      const result = installRun(command, box, "cursor", scope);
      t.assert.equal(result.status, 2, result.stdout);
      t.assert.match(result.stdout, /INSTALL-STATE/);
      t.assert.deepEqual(tree(box.root), before);
    }
  }
  await box.write(path, binding);
  const removed = installRun("remove", box, "cursor", "user");
  t.assert.equal(removed.status, 0, removed.stdout);
});
