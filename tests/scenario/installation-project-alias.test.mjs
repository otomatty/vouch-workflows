import { spawnSync } from "node:child_process";
import { symlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { cursorInput, distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "installed project hooks and doctor retain activation through a junction",
  async (t) => {
    const box = await sandbox(t);
    const alias = box.path("alias");
    let entry = "";
    await test(
      "install the real project runtime and create its alias",
      async (t) => {
        distribution(t, box, "cursor");
        const installed = installRun("install", box, "cursor", "project");
        t.assert.equal(installed.status, 0, installed.stdout);
        const runtimeRoot = JSON.parse(installed.stdout).runtimeRoot;
        await symlink(box.path("project"), alias, "junction");
        entry = join(
          alias,
          relative(box.path("project"), runtimeRoot),
          "hooks/vouch-launch.mjs",
        );
      },
      t,
    );
    for (const action of ["guard", "doctor"])
      await test(
        `${action} executes through the actual alias and preserves project bytes`,
        (t) => {
          const before = tree(box.root);
          const result = spawnSync(
            process.execPath,
            [entry, action, "project", alias],
            {
              cwd: alias,
              ...(action === "guard"
                ? {
                    input: JSON.stringify(
                      cursorInput(alias, "preToolUse", {
                        tool_name: "Delete",
                        tool_input: { file_path: ".cursor/hooks.json" },
                      }),
                    ),
                  }
                : {}),
              encoding: "utf8",
              windowsHide: true,
              timeout: 4000,
            },
          );
          t.assert.equal(result.status, 0, result.stdout + result.stderr);
          const output = JSON.parse(result.stdout);
          if (action === "guard") {
            t.assert.equal(output.permission, "deny", result.stdout);
            t.assert.match(output.user_message, /VOUCH-GUARD-INSTALLATION/);
          } else t.assert.equal(output.ok, true, result.stdout);
          t.assert.deepEqual(tree(box.root), before);
        },
        t,
      );
  },
);
