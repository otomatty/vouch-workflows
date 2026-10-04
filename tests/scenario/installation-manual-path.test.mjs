import { spawnSync } from "node:child_process";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { test as group } from "node:test";
import { installedText } from "../../core/hooks/lib/installation-runtime.mjs";
import { windowsShell } from "../../scripts/lib/powershell.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

const shells =
  process.platform === "win32"
    ? [
        { executable: windowsShell(), args: ["-NoProfile", "-Command"] },
        {
          executable: join(
            process.env.ProgramFiles ?? "C:\\Program Files",
            "Git/bin/bash.exe",
          ),
          args: ["-c"],
        },
      ]
    : [{ executable: "/bin/sh", args: ["-c"] }];
const digest = "a".repeat(64);
/** @param {string} harness */
const reference = (harness) => `.vouch/versions/${digest}/${harness}`;
/** @param {typeof shells[number]} shell @param {string} command @param {string} cwd */
const execute = (shell, command, cwd) =>
  spawnSync(shell.executable, [...shell.args, command], {
    cwd,
    env: { ...process.env, VOUCH_PROJECT_ROOT: join(cwd, "wrong-project") },
    encoding: "utf8",
    windowsHide: true,
    timeout: 4000,
  });

for (const harness of ["claude", "codex", "cursor"])
  for (const shell of shells)
    for (const directory of ["project", "project/src/deeper"])
      test(`${harness}: manual commands preserve cwd and arguments from ${directory} through ${shell.executable}`, async (t) => {
        const box = await sandbox(t, { git: false });
        await box.write(
          `project/${reference(harness)}/hooks/vouch-launch.mjs`,
          "console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),root:process.env.VOUCH_PROJECT_ROOT}));\n",
        );
        await mkdir(box.path(directory), { recursive: true });
        const command = installedText(
          `node .${harness}/hooks/vouch-lifecycle.mjs stage-started design`,
          harness,
          reference(harness),
        );
        const before = tree(box.root);
        const result = execute(shell, command, box.path(directory));
        t.assert.equal(result.status, 0, result.stderr);
        t.assert.deepEqual(JSON.parse(result.stdout), {
          args: ["lifecycle", "manual", "stage-started", "design"],
          cwd: box.path(directory),
        });
        t.assert.deepEqual(tree(box.root), before);
      });

for (const missing of ["entry", "dependency"])
  test(`a missing manual launcher ${missing} fails without executing another ancestor or changing files`, async (t) => {
    const box = await sandbox(t, { git: false });
    await mkdir(box.path("project/nested/src"), { recursive: true });
    if (missing === "dependency") {
      await box.write(
        `project/${reference("codex")}/hooks/vouch-launch.mjs`,
        "console.log('incorrect outer launcher');\n",
      );
      await box.write(
        `project/nested/${reference("codex")}/hooks/vouch-launch.mjs`,
        "import './missing.mjs';\n",
      );
    }
    const command = installedText(
      "node .codex/hooks/vouch-doctor.mjs",
      "codex",
      reference("codex"),
    );
    const before = tree(box.root);
    const result = execute(shells[0], command, box.path("project/nested/src"));
    t.assert.equal(result.status, 2, result.stderr);
    t.assert.equal(result.stdout, "");
    t.assert.match(
      result.stderr,
      missing === "entry" ? /INSTALL-INACTIVE/ : /missing\.mjs/,
    );
    t.assert.deepEqual(tree(box.root), before);
  });

group(
  "installed project manual guidance selects the project from root, subdirectory and after a move",
  async (t) => {
    const box = await sandbox(t);
    let command = "";
    await test(
      "install and initialize the real Codex project and read its doctor guidance",
      async (t) => {
        distribution(t, box, "codex");
        await mkdir(box.path("project/src"), { recursive: true });
        const installed = installRun("install", box, "codex", "project");
        t.assert.equal(installed.status, 0, installed.stdout);
        t.assert.equal(
          installRun("init", box, "codex", "project", ["--intent", "manual"])
            .status,
          0,
        );
        const state = JSON.parse(installed.stdout);
        command = installedText(
          "node .codex/hooks/vouch-doctor.mjs",
          "codex",
          `.vouch/versions/${state.digest}/codex`,
        );
        t.assert.equal(
          (
            await box.read("project/.codex/skills/vouch/references/doctor.md")
          ).includes(command),
          true,
        );
      },
      t,
    );
    for (const directory of ["project", "project/src", "moved/src"])
      await test(
        `the documented doctor command diagnoses ${directory} without writing`,
        async (t) => {
          if (directory.startsWith("moved"))
            await rename(box.path("project"), box.path("moved"));
          const before = tree(box.root);
          const result = execute(shells[0], command, box.path(directory));
          t.assert.equal(result.status, 0, result.stderr);
          t.assert.equal(JSON.parse(result.stdout).ok, true);
          t.assert.deepEqual(tree(box.root), before);
        },
        t,
      );
  },
);
