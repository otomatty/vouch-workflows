import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { cursorInput, distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "the installed user Cursor guard protects globbed registrations and the exact project root",
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
        t.assert.equal(result.status, 0, result.stderr);
        t.assert.equal(JSON.parse(result.stdout).permission, "deny");
        t.assert.match(
          JSON.parse(result.stdout).user_message,
          /VOUCH-GUARD-INSTALLATION/,
        );
        t.assert.deepEqual(tree(box.root), before);
      },
      t,
    );
    await test(
      "Delete of dot or the absolute project root returns deny and preserves every file",
      (t) => {
        const before = tree(box.root);
        for (const file_path of [".", box.path("project")]) {
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
                  tool_name: "Delete",
                  tool_input: { file_path },
                }),
              ),
              encoding: "utf8",
              windowsHide: true,
              timeout: 4000,
            },
          );
          t.assert.equal(result.status, 0, result.stderr);
          const output = JSON.parse(result.stdout);
          t.assert.equal(output.permission, "deny", file_path);
          t.assert.match(
            output.user_message,
            /VOUCH-GUARD-(AUDIT|INSTALLATION)/,
          );
          t.assert.deepEqual(tree(box.root), before);
        }
      },
      t,
    );
    for (const [suffix, permission] of [
      ["notes.txt", "allow"],
      ["vouch-guard-writes.mjs", "deny"],
    ])
      await test(
        `recursive glob preserves its ${suffix} suffix and returns ${permission}`,
        (t) => {
          const before = tree(box.root);
          const home = box.path("home").replaceAll("\\", "/");
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
                  tool_input: { command: `rm "${home}"/**/${suffix}` },
                }),
              ),
              encoding: "utf8",
              windowsHide: true,
              timeout: 4000,
            },
          );
          t.assert.equal(result.status, 0, result.stderr);
          const output = JSON.parse(result.stdout);
          t.assert.equal(output.permission, permission, result.stdout);
          if (permission === "deny")
            t.assert.match(output.user_message, /VOUCH-GUARD-INSTALLATION/);
          t.assert.deepEqual(tree(box.root), before);
        },
        t,
      );
    for (const prefix of ["$HOME", "~alice", "/home/$USER"])
      for (const suffix of [
        `.cur\${X}sor/hooks.json`,
        ".cursor/hooks.json",
        `.vouch/versions/${runtimeRoot.split(/[\\/]/).at(-2)}/cursor/hooks/vouch-guard-writes.mjs`,
      ])
        await test(
          `an external tool cwd cannot bypass protection through ${prefix}/${suffix}`,
          (t) => {
            const before = tree(box.root);
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
                    tool_input: {
                      command: prefix.startsWith("~")
                        ? `rm ${prefix}/${suffix}`
                        : `rm "${prefix}/${suffix}"`,
                      working_directory: box.path("home"),
                    },
                  }),
                ),
                encoding: "utf8",
                windowsHide: true,
                timeout: 4000,
              },
            );
            t.assert.equal(result.status, 0, result.stderr);
            const output = JSON.parse(result.stdout);
            t.assert.equal(output.permission, "deny", result.stdout);
            t.assert.match(output.user_message, /VOUCH-GUARD-INSTALLATION/);
            t.assert.deepEqual(tree(box.root), before);
          },
          t,
        );
  },
);
