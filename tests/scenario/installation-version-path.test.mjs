import { cp } from "node:fs/promises";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const scope of ["project", "user"])
  group(
    `${scope}: initialization rejects a digest-valid copied runtime outside its canonical version location`,
    async (t) => {
      const box = await sandbox(t);
      const root = scope === "project" ? "project" : "home";
      const statePath = `${root}/.vouch/installations/codex.json`;
      let original = "";
      await test(
        "install the original version and copy its complete runtime",
        async (t) => {
          distribution(t, box, "codex");
          const result = installRun("install", box, "codex", scope);
          t.assert.equal(result.status, 0, result.stdout);
          if (scope === "user")
            t.assert.equal(installRun("init", box, "codex", scope).status, 0);
          original = await box.read(statePath);
          const runtimeRoot = JSON.parse(result.stdout).runtimeRoot;
          await cp(runtimeRoot, box.path(`${root}/.vouch/copied-runtime`), {
            recursive: true,
          });
          t.assert.deepEqual(
            tree(box.path(`${root}/.vouch/copied-runtime`)),
            tree(runtimeRoot),
          );
        },
        t,
      );
      await test(
        "reject the alternate path before changing either scope",
        async (t) => {
          await box.write(
            statePath,
            JSON.stringify({
              ...JSON.parse(original),
              runtimeRoot: ".vouch/copied-runtime",
            }),
          );
          const before = tree(box.path("project"));
          const home = scope === "user" ? tree(box.path("home")) : null;
          const result = installRun("init", box, "codex", scope, [
            "--intent",
            "must-not-save",
          ]);
          t.assert.equal(result.status, 2, result.stdout);
          t.assert.match(
            result.stdout,
            /INSTALL-VERSION: runtime path differs/,
          );
          t.assert.deepEqual(tree(box.path("project")), before);
          if (home) t.assert.deepEqual(tree(box.path("home")), home);
        },
        t,
      );
      await test(
        "restore the canonical descriptor and initialize normally",
        async (t) => {
          await box.write(statePath, original);
          t.assert.equal(installRun("init", box, "codex", scope).status, 0);
          t.assert.equal(installRun("doctor", box, "codex", scope).status, 0);
        },
        t,
      );
    },
  );
