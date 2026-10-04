import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { cursorInput, distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "the installed user Cursor guard refuses an external glob that Bash expands to hooks.json",
  async (t) => {
    const box = await sandbox(t);
    let runtimeRoot = "";
    await test(
      "install the actual user runtime and connect its project",
      (t) => {
        distribution(t, box, "cursor");
        const installed = installRun("install", box, "cursor", "user");
        t.assert.equal(installed.status, 0, installed.stdout);
        runtimeRoot = JSON.parse(installed.stdout).runtimeRoot;
        t.assert.equal(installRun("init", box, "cursor", "user").status, 0);
      },
      t,
    );
    await test(
      "observe Bash expansion with printf and refuse the corresponding deletion without changing files",
      (t) => {
        const directory = box.path("home/.cursor").replaceAll("\\", "/");
        const operand = `"${directory}/"*.json`;
        const before = tree(box.root);
        const expanded = spawnSync(
          process.platform === "win32"
            ? join(
                process.env.ProgramFiles ?? "C:\\Program Files",
                "Git/bin/bash.exe",
              )
            : "/bin/sh",
          ["-c", `printf '%s\\n' ${operand}`],
          {
            cwd: box.path("project"),
            encoding: "utf8",
            windowsHide: true,
            timeout: 4000,
          },
        );
        t.assert.equal(expanded.status, 0, expanded.stderr);
        t.assert.equal(
          expanded.stdout.trim().replaceAll("\\", "/"),
          `${directory}/hooks.json`,
        );
        const result = spawnSync(
          process.execPath,
          [
            join(runtimeRoot, "hooks/vouch-launch.mjs"),
            "guard",
            "project",
            box.path("project"),
          ],
          {
            cwd: box.path("project"),
            input: JSON.stringify(
              cursorInput(box.path("project"), "preToolUse", {
                tool_name: "run_terminal_cmd",
                tool_input: { command: `rm ${operand}` },
              }),
            ),
            encoding: "utf8",
            windowsHide: true,
            timeout: 4000,
          },
        );
        t.assert.equal(result.status, 2, result.stderr);
        t.assert.equal(JSON.parse(result.stdout).permission, "deny");
        t.assert.match(result.stderr, /VOUCH-GUARD-INSTALLATION/);
        t.assert.deepEqual(tree(box.root), before);
      },
      t,
    );
  },
);
