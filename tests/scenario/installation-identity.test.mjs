import { test as group } from "node:test";
import { install } from "../../scripts/lib/install.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "project binding changes reject another scope or harness before either scope changes",
  async (t) => {
    const box = await sandbox(t);
    const path = "project/.vouch/bindings/cursor.json";
    let binding = "";
    await test(
      "install and bind the user runtime",
      async (t) => {
        distribution(t, box);
        t.assert.equal(installRun("install", box, "cursor", "user").status, 0);
        t.assert.equal(installRun("init", box, "cursor", "user").status, 0);
        binding = await box.read(path);
      },
      t,
    );
    for (const identity of [{ scope: "project" }, { harness: "claude" }]) {
      await test(
        `reject a different binding ${Object.keys(identity)[0]}`,
        async (t) => {
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
        },
        t,
      );
    }
    await test(
      "restore the identity and remove the user binding",
      async (t) => {
        await box.write(path, binding);
        const removed = installRun("remove", box, "cursor", "user");
        t.assert.equal(removed.status, 0, removed.stdout);
      },
      t,
    );
  },
);
