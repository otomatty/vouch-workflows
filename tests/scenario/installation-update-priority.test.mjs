import { lstat, rm, symlink } from "node:fs/promises";
import { test as group } from "node:test";
import { install } from "../../scripts/lib/install.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex", "cursor"])
  group(
    `${harness}: local installation and update ignore unselected stale user bindings`,
    async (t) => {
      const box = await sandbox(t, { git: false });
      distribution(t, box, harness);
      const options = {
        harness,
        scope: "project",
        home: box.path("home"),
        project: box.path("project"),
        projectExplicit: true,
        dist: box.path("dist"),
        intent: "local",
      };
      const original = install(options, "install");
      const oldRuntime = tree(original.runtimeRoot);
      const descriptor = JSON.parse(
        await box.read(`project/.vouch/installations/${harness}.json`),
      );
      await box.write(
        `home/.vouch/installations/${harness}.json`,
        "unselected malformed user installation",
      );
      const home = tree(box.path("home"));
      const asset = `dist/${harness}/.${harness}/templates/ja/rules.md`;
      await box.write(
        asset,
        `${await box.read(asset)}\nUpdated distribution fixture.\n`,
      );
      for (const variant of ["malformed-json", "different-harness", "linked"])
        await test(
          `install and update preserve the ${variant} binding and the old immutable runtime`,
          async (t) => {
            const path = `project/.vouch/bindings/${harness}.json`;
            const body =
              variant === "different-harness"
                ? JSON.stringify({
                    ...descriptor,
                    scope: "user",
                    harness: harness === "claude" ? "cursor" : "claude",
                  })
                : "unselected malformed binding";
            if (variant === "linked") {
              await box.write("binding-target.json", body);
              await symlink(box.path("binding-target.json"), box.path(path));
            } else await box.write(path, body);
            try {
              if (variant === "malformed-json") {
                const result = installRun("update", box, harness, "project", [
                  "--intent",
                  "local",
                ]);
                t.assert.equal(result.status, 0, result.stdout + result.stderr);
                t.assert.notEqual(
                  JSON.parse(result.stdout).digest,
                  original.digest,
                );
              }
              for (const command of /** @type {const} */ ([
                "install",
                "update",
              ])) {
                const result = install(options, command);
                t.assert.notEqual(result.digest, original.digest);
                const config = JSON.parse(
                  await box.read("project/vouch/config.json"),
                );
                t.assert.equal(config.harnesses[harness].digest, result.digest);
                t.assert.equal(config.intent, "local");
                t.assert.equal(await box.read(path), body);
                t.assert.deepEqual(tree(original.runtimeRoot), oldRuntime);
                t.assert.deepEqual(tree(box.path("home")), home);
              }
              if (variant === "linked") {
                t.assert.equal(
                  (await lstat(box.path(path))).isSymbolicLink(),
                  true,
                );
                t.assert.equal(await box.read("binding-target.json"), body);
              }
            } finally {
              await rm(box.path(path));
            }
          },
          t,
        );
    },
  );
