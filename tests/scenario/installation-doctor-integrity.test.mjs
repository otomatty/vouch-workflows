import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test as group } from "node:test";
import { diagnose } from "../../scripts/lib/install.mjs";
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
      if (!template) throw new Error("TEST-FIXTURE: runtime template missing");
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
            const original =
              path === "distribution/extra-unrecorded.txt"
                ? null
                : await readFile(target, "utf8");
            await box.write(
              target,
              `${original ?? ""}${path.endsWith(".json") ? " \n" : "\nchanged nonempty bytes\n"}`,
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
              if (original !== null) await box.write(target, original);
              else await rm(target);
            }
          },
          t,
        );
      for (const [name, invalid] of [
        ["missing array separators cannot look active", "bad = [1 2]"],
        [
          "missing inline separators cannot look active",
          "bad = { a = 1 b = 2 }",
        ],
        ["an assignment without a value cannot look active", "bad ="],
        [
          "a comment cannot supply a missing assignment value",
          "bad = # trailing",
        ],
        [
          "an EOF comment cannot hide an unmatched Codex array bracket",
          "x = ] # trailing",
        ],
        [
          "an unfinished inline table cannot look like active Codex settings",
          "x = { a = 1 # trailing",
        ],
      ])
        await test(
          `${name} from doctor`,
          async (t) => {
            const path = "project/.codex/config.toml";
            const original = await box.read(path);
            await box.write(path, `${original}\n${invalid}`);
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
              t.assert.throws(
                () =>
                  diagnose({
                    harness: "codex",
                    scope,
                    home: box.path("home"),
                    project: box.path("project"),
                    projectExplicit: true,
                    dist: box.path("dist"),
                  }),
                /INSTALL-CONFIG/,
              );
              t.assert.deepEqual(tree(box.root), before);
            } finally {
              await box.write(path, original);
            }
          },
          t,
        );
    },
  );
