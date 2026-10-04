import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test as group } from "node:test";
import { initialize, install } from "../../scripts/lib/install.mjs";
import { windowsShell } from "../../scripts/lib/powershell.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { cursorInput, distribution } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "the registered user Cursor guard remains active until its replacement is fully verified",
  async (t) => {
    const box = await sandbox(t);
    const options = {
      harness: "cursor",
      scope: "user",
      home: box.path("home"),
      project: box.path("project"),
      projectExplicit: true,
      dist: box.path("dist"),
      intent: "scope",
    };
    let command = "";
    const execute = () =>
      spawnSync(
        process.platform === "win32" ? windowsShell() : "/bin/sh",
        process.platform === "win32"
          ? ["-NoProfile", "-Command", `${command}; exit $LASTEXITCODE`]
          : ["-c", command],
        {
          cwd: box.path("project"),
          env: { ...process.env, CURSOR_PROJECT_DIR: box.path("project") },
          input: JSON.stringify(
            cursorInput(box.path("project"), "preToolUse", {
              tool_name: "Delete",
              tool_input: { file_path: box.path("home/.cursor/hooks.json") },
            }),
          ),
          encoding: "utf8",
          windowsHide: true,
          timeout: 4000,
        },
      );
    let selected = "";
    let originalConfig = "";
    await test(
      "install a real project replacement and suppress only the verified duplicate",
      async (t) => {
        distribution(t, box, "cursor");
        install(options, "install");
        initialize(options);
        const registration = JSON.parse(
          await box.read("home/.cursor/hooks.json"),
        );
        command = registration.hooks.preToolUse[0].command;
        const local = install({ ...options, scope: "project" }, "install");
        selected = local.runtimeRoot;
        originalConfig = await box.read("project/vouch/config.json");
        const before = tree(box.root);
        const result = execute();
        t.assert.equal(result.status, 0, result.stderr);
        t.assert.equal(JSON.parse(result.stdout).permission, "allow");
        t.assert.deepEqual(tree(box.root), before);
      },
      t,
    );
    for (const kind of [
      "nonexistent",
      "descriptor",
      "receipt",
      "registration",
      "runtime-bytes",
    ])
      await test(
        `${kind}: the trusted global guard denies a write and preserves every file`,
        async (t) => {
          const path =
            kind === "nonexistent"
              ? box.path("project/vouch/config.json")
              : kind === "descriptor"
                ? join(selected, "registry/installation.json")
                : kind === "receipt"
                  ? box.path("project/.vouch/installations/cursor.json")
                  : kind === "registration"
                    ? box.path("project/.cursor/hooks.json")
                    : join(selected, "hooks/vouch-guard-writes.mjs");
          const original = await readFile(path, "utf8");
          if (kind === "nonexistent") {
            const config = JSON.parse(originalConfig);
            config.harnesses.cursor.digest = "f".repeat(64);
            config.harnesses.cursor.runtimeRoot = `.vouch/versions/${"f".repeat(64)}/cursor`;
            await box.write(path, JSON.stringify(config));
          } else if (kind === "receipt" || kind === "registration")
            await rm(path);
          else
            await box.write(
              path,
              kind === "descriptor"
                ? JSON.stringify({ harness: "claude" })
                : `${original}\nthrow new Error('replacement must not execute');\n`,
            );
          try {
            const before = tree(box.root);
            const result = execute();
            t.assert.equal(result.status, 0, result.stdout + result.stderr);
            t.assert.equal(
              JSON.parse(result.stdout).permission,
              "deny",
              result.stdout,
            );
            t.assert.match(
              JSON.parse(result.stdout).user_message,
              /VOUCH-GUARD-INSTALLATION/,
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
