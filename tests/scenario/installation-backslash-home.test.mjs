import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test as group } from "node:test";
import { windowsShell } from "../../scripts/lib/powershell.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { cursorInput, distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

/** @param {string} command @param {string} cwd @param {string} [input] @param {boolean} [native] */
const execute = (command, cwd, input, native = false) =>
  spawnSync(
    process.platform === "win32"
      ? native
        ? windowsShell()
        : join(
            process.env.ProgramFiles ?? "C:\\Program Files",
            "Git/bin/bash.exe",
          )
      : "/bin/sh",
    process.platform === "win32" && native
      ? ["-NoProfile", "-Command", `${command}; exit $LASTEXITCODE`]
      : ["-c", command],
    {
      cwd,
      input,
      env: { ...process.env, VOUCH_PROJECT_ROOT: cwd, CURSOR_PROJECT_DIR: cwd },
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    },
  );

group(
  "user runtime references retain the platform meaning of a backslash",
  async (t) => {
    const box = await sandbox(t);
    const home = box.path("home\\name");
    const extra = ["--home", home];
    await test(
      "install and connect the actual user runtime",
      (t) => {
        distribution(t, box, "cursor");
        const installed = installRun("install", box, "cursor", "user", extra);
        t.assert.equal(installed.status, 0, installed.stdout);
        const initialized = installRun("init", box, "cursor", "user", extra);
        t.assert.equal(initialized.status, 0, initialized.stdout);
      },
      t,
    );
    await test(
      "execute the complete documented manual doctor command and preserve files",
      async (t) => {
        const skill = await box.read(
          "project/.cursor/skills/vouch/references/doctor.md",
        );
        const command = /```sh\r?\n(node [^\r\n]+)\r?\n```/.exec(skill)?.[1];
        t.assert.equal(typeof command, "string", skill);
        const guidance = await box.read("project/AGENTS.md");
        if (process.platform !== "win32")
          t.assert.match(guidance, /home%5Cname/);
        const before = tree(box.root);
        const result = execute(command ?? "", box.path("project"));
        t.assert.equal(result.status, 0, result.stdout + result.stderr);
        t.assert.equal(JSON.parse(result.stdout).ok, true, result.stdout);
        t.assert.deepEqual(tree(box.root), before);
      },
      t,
    );
    await test(
      "the actual registered Cursor guard denies protected writes and preserves files",
      async (t) => {
        const registration = JSON.parse(
          await box.read("project/.cursor/hooks.json"),
        );
        const before = tree(box.root);
        const result = execute(
          registration.hooks.preToolUse[0].command,
          box.path("project"),
          JSON.stringify(
            cursorInput(box.path("project"), "preToolUse", {
              tool_name: "Delete",
              tool_input: { file_path: ".cursor/hooks.json" },
            }),
          ),
          true,
        );
        t.assert.equal(result.status, 0, result.stdout + result.stderr);
        t.assert.equal(
          JSON.parse(result.stdout).permission,
          "deny",
          result.stdout,
        );
        t.assert.deepEqual(tree(box.root), before);
      },
      t,
    );
  },
);
