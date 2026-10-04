import { install } from "../../scripts/lib/install.mjs";
import { hookTest as test } from "./hook-test.mjs";
import { distribution, installRun } from "./install.mjs";
import { tree } from "./packaging.mjs";
import { sandbox } from "./runtime.mjs";

/** @param {string} harness */
export function installationIdentity(harness) {
  for (const scope of ["project", "user"])
    test(`${harness}/${scope}: scoped changes reject a different stored scope or harness and preserve ownership`, async (t) => {
      const box = await sandbox(t);
      distribution(t, box, harness);
      const installed = installRun("install", box, harness, scope);
      t.assert.equal(installed.status, 0, installed.stdout);
      const root = scope === "project" ? "project" : "home";
      const statePath = `${root}/.vouch/installations/${harness}.json`;
      const state = await box.read(statePath);
      const options = {
        harness,
        scope,
        home: box.path("home"),
        project: box.path("project"),
        projectExplicit: true,
        dist: box.path("dist"),
      };
      const before = tree(box.path(root));
      const opposite = scope === "project" ? "user" : "project";
      for (const command of ["remove", "update", "install"]) {
        if (command === "remove") {
          const result = installRun(command, box, harness, opposite, [
            scope === "project" ? "--home" : "--project",
            box.path(root),
          ]);
          t.assert.equal(result.status, 2, result.stdout);
          t.assert.match(result.stdout, /INSTALL-STATE/);
        } else {
          t.assert.throws(
            () =>
              install(
                {
                  ...options,
                  scope: opposite,
                  [scope === "project" ? "home" : "project"]: box.path(root),
                },
                command === "update" ? "update" : "install",
              ),
            /INSTALL-STATE/,
          );
        }
        t.assert.deepEqual(tree(box.path(root)), before);
      }
      const altered = {
        ...JSON.parse(state),
        harness: harness === "cursor" ? "claude" : "cursor",
      };
      await box.write(statePath, JSON.stringify(altered));
      const mismatched = tree(box.path(root));
      for (const command of ["remove", "update", "install", "init"]) {
        if (command === "remove" || command === "init") {
          const result = installRun(command, box, harness, scope);
          t.assert.equal(result.status, 2, result.stdout);
          t.assert.match(result.stdout, /INSTALL-STATE/);
        } else {
          t.assert.throws(
            () => install(options, command === "update" ? "update" : "install"),
            /INSTALL-STATE/,
          );
        }
        t.assert.deepEqual(tree(box.path(root)), mismatched);
      }
      await box.write(statePath, state);
      const removed = installRun("remove", box, harness, scope);
      t.assert.equal(removed.status, 0, removed.stdout);
      await t.assert.rejects(box.read(statePath), { code: "ENOENT" });
    });
}
