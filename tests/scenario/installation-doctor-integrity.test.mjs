import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const scope of ["project", "user"])
  group(
    `managed ${scope} doctor verifies runtime and archive bytes`,
    async (t) => {
      const box = await sandbox(t);
      let runtimeRoot = "";
      const doctor = () =>
        spawnSync(
          process.execPath,
          [
            join(runtimeRoot, "hooks/vouch-launch.mjs"),
            "doctor",
            "project",
            box.path("project"),
          ],
          { cwd: box.path("project"), encoding: "utf8", timeout: 4000 },
        );
      await test(
        "install, activate and verify the unmodified runtime",
        async (t) => {
          distribution(t, box, "codex");
          const installed = installRun("install", box, "codex", scope);
          t.assert.equal(
            installed.status,
            0,
            installed.stdout + installed.stderr,
          );
          runtimeRoot = JSON.parse(installed.stdout).runtimeRoot;
          t.assert.equal(installRun("init", box, "codex", scope).status, 0);
          const before = tree(box.root);
          const result = doctor();
          t.assert.equal(result.status, 0, result.stdout + result.stderr);
          t.assert.deepEqual(tree(box.root), before);
        },
        t,
      );
      const template = Object.keys(tree(runtimeRoot)).find(
        (path) => path.startsWith("templates/") && path.endsWith(".md"),
      );
      t.assert.ok(template);
      for (const path of [
        "hooks/vouch-guard-writes.mjs",
        "registry/workflow.json",
        template,
        "AGENTS.md",
        "distribution/.codex/hooks/vouch-guard-writes.mjs",
        "distribution/extra-unrecorded.txt",
      ])
        await test(
          `reject nonempty content change: ${path}`,
          async (t) => {
            const target = join(runtimeRoot, path);
            const original = tree(runtimeRoot)[path];
            await box.write(
              target,
              `${original ?? ""}\nchanged nonempty bytes\n`,
            );
            try {
              const before = tree(box.root);
              const result = doctor();
              t.assert.equal(result.status, 2, result.stdout + result.stderr);
              t.assert.equal(
                JSON.parse(result.stdout).checks.some(
                  (/** @type {{id:string,ok:boolean}} */ check) =>
                    check.id === "DOCTOR-ACTIVATION" && !check.ok,
                ),
                true,
              );
              t.assert.deepEqual(tree(box.root), before);
            } finally {
              if (original !== undefined) await box.write(target, original);
            }
          },
          t,
        );
    },
  );
