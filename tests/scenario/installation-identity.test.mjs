import { install } from "../../scripts/lib/install.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

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
      if (command === "install") {
        t.assert.throws(
          () =>
            install(
              {
                harness: "cursor",
                scope,
                home: box.path("home"),
                project: box.path("project"),
                projectExplicit: true,
                dist: box.path("dist"),
              },
              "install",
            ),
          /INSTALL-STATE/,
        );
      } else {
        const result = installRun(command, box, "cursor", scope);
        t.assert.equal(result.status, 2, result.stdout);
        t.assert.match(result.stdout, /INSTALL-STATE/);
      }
      t.assert.deepEqual(tree(box.root), before);
    }
  }
  await box.write(path, binding);
  const removed = installRun("remove", box, "cursor", "user");
  t.assert.equal(removed.status, 0, removed.stdout);
});
