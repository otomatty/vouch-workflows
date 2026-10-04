import { spawnSync } from "node:child_process";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "distributed doctor inspects all owned Codex activation without changing project files",
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
        {
          cwd: box.path("project"),
          encoding: "utf8",
          timeout: 4000,
        },
      );
    await test(
      "install and activate the shared runtime with preexisting enabled Codex settings",
      async (t) => {
        distribution(t, box, "codex");
        await box.write(
          "project/.codex/config.toml",
          "[features]\nhooks = true\n\n[agents]\nmax_depth = 3\n",
        );
        const installed = installRun("install", box, "codex", "user");
        t.assert.equal(installed.status, 0, installed.stdout);
        runtimeRoot = JSON.parse(installed.stdout).runtimeRoot;
        t.assert.equal(installRun("init", box, "codex", "user").status, 0);
        const before = tree(box.path("project"));
        const result = doctor();
        t.assert.equal(result.status, 0, result.stdout + result.stderr);
        t.assert.deepEqual(tree(box.path("project")), before);
      },
      t,
    );
    for (const path of [
      ".codex/config.toml",
      ".agents/skills/vouch/SKILL.md",
      "AGENTS.md",
    ])
      await test(
        `reject the missing activation ${path}`,
        async (t) => {
          const target = box.path(`project/${path}`);
          const saved = box.path("saved-owned");
          await rename(target, saved);
          try {
            const before = tree(box.path("project"));
            const result = doctor();
            t.assert.equal(result.status, 2, result.stdout + result.stderr);
            t.assert.equal(
              JSON.parse(result.stdout).checks.some(
                (/** @type {{id:string,ok:boolean}} */ check) =>
                  check.id === "DOCTOR-ACTIVATION" && !check.ok,
              ),
              true,
            );
            t.assert.deepEqual(tree(box.path("project")), before);
          } finally {
            await rename(saved, target);
          }
        },
        t,
      );
    await test(
      "reject disabled preexisting Codex hooks even when no TOML setting is owned",
      async (t) => {
        const path = "project/.codex/config.toml";
        const original = await box.read(path);
        await box.write(
          path,
          (await box.read(path)).replace("hooks = true", "hooks = false"),
        );
        const before = tree(box.path("project"));
        const result = doctor();
        t.assert.equal(result.status, 2, result.stdout + result.stderr);
        t.assert.equal(
          JSON.parse(result.stdout).checks.some(
            (/** @type {{id:string,ok:boolean}} */ check) =>
              check.id === "DOCTOR-ACTIVATION" && !check.ok,
          ),
          true,
        );
        t.assert.deepEqual(tree(box.path("project")), before);
        await box.write(path, original);
      },
      t,
    );
    await test(
      "reject hooks and depth declared only inside a multiline instruction",
      async (t) => {
        const path = "project/.codex/config.toml";
        const original = await box.read(path);
        await box.write(
          path,
          "developer_instructions = '''\n[features]\nhooks = true\n[agents]\nmax_depth = 3\n'''\n",
        );
        try {
          const before = tree(box.path("project"));
          const result = doctor();
          t.assert.equal(result.status, 2, result.stdout + result.stderr);
          t.assert.equal(
            JSON.parse(result.stdout).checks.some(
              (/** @type {{id:string,ok:boolean}} */ check) =>
                check.id === "DOCTOR-ACTIVATION" && !check.ok,
            ),
            true,
          );
          t.assert.deepEqual(tree(box.path("project")), before);
        } finally {
          await box.write(path, original);
        }
      },
      t,
    );
    for (const identity of [
      { scope: "project" },
      { digest: "f".repeat(64) },
      { runtimeRoot: box.path("another-runtime") },
    ])
      await test(
        `reject mismatched activation ${Object.keys(identity)[0]}`,
        async (t) => {
          const path = "project/.vouch/bindings/codex.json";
          const original = await box.read(path);
          await box.write(
            path,
            JSON.stringify({ ...JSON.parse(original), ...identity }),
          );
          try {
            const before = tree(box.path("project"));
            const result = doctor();
            t.assert.equal(result.status, 2, result.stdout + result.stderr);
            t.assert.equal(
              JSON.parse(result.stdout).checks.some(
                (/** @type {{id:string,ok:boolean}} */ check) =>
                  check.id === "DOCTOR-ACTIVATION" && !check.ok,
              ),
              true,
            );
            t.assert.deepEqual(tree(box.path("project")), before);
            const installerDoctor = installRun("doctor", box, "codex", "user");
            t.assert.equal(installerDoctor.status, 2, installerDoctor.stdout);
            t.assert.deepEqual(tree(box.path("project")), before);
          } finally {
            await box.write(path, original);
          }
        },
        t,
      );
    for (const kind of ["skill", "agent", "block", "toml"])
      for (const route of ["distributed", "installer"])
        await test(
          `${route} doctor rejects a missing ${kind} hidden by a truncated ownership manifest`,
          async (t) => {
            const statePath = "project/.vouch/bindings/codex.json";
            const original = await box.read(statePath);
            const state = JSON.parse(original);
            const entry = state.owned.find(
              (/** @type {{path:string,kind:string}} */ item) =>
                kind === "skill"
                  ? item.path === ".agents/skills/vouch/SKILL.md"
                  : kind === "agent"
                    ? item.path.startsWith(".codex/agents/")
                    : item.kind === kind,
            );
            if (!entry) throw new Error(`missing ${kind} fixture`);
            const target = box.path(`project/${entry.path}`);
            const saved = box.path("saved-manifest-entry");
            await box.write(
              statePath,
              JSON.stringify({
                ...state,
                owned: state.owned.filter(
                  (/** @type {{kind:string}} */ item) => item.kind === "hooks",
                ),
              }),
            );
            await rename(target, saved);
            try {
              const before = tree(box.root);
              const result =
                route === "distributed"
                  ? doctor()
                  : installRun("doctor", box, "codex", "user");
              t.assert.equal(result.status, 2, result.stdout + result.stderr);
              t.assert.deepEqual(tree(box.root), before);
            } finally {
              await rename(saved, target);
              await box.write(statePath, original);
            }
          },
          t,
        );
  },
);
