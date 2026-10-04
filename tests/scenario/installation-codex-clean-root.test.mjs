import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { test as group } from "node:test";
import { windowsShell } from "../../scripts/lib/powershell.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const scope of ["project", "user"])
  group(
    `${scope}: registered Codex hooks run without Vouch root environment variables`,
    async (t) => {
      const box = await sandbox(t);
      let hooks = JSON.parse("{}");
      const env = { ...process.env };
      for (const name of [
        "VOUCH_PROJECT_ROOT",
        "CLAUDE_PROJECT_DIR",
        "CURSOR_PROJECT_DIR",
      ])
        delete env[name];
      /** @param {string} event @param {string} cwd @param {object} payload */
      const invoke = (event, cwd, payload) => {
        const entry = hooks[event][0].hooks[0];
        return spawnSync(
          process.platform === "win32" ? windowsShell() : "/bin/sh",
          process.platform === "win32"
            ? [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                entry.commandWindows,
              ]
            : ["-c", entry.command],
          {
            cwd,
            env,
            input: JSON.stringify(payload),
            encoding: "utf8",
            windowsHide: true,
            timeout: 4000,
          },
        );
      };
      await test(
        "install and initialize the actual Codex registration",
        async (t) => {
          distribution(t, box, "codex");
          await mkdir(box.path("project/src"), { recursive: true });
          t.assert.equal(installRun("install", box, "codex", scope).status, 0);
          t.assert.equal(
            installRun("init", box, "codex", scope, ["--intent", "clean-root"])
              .status,
            0,
          );
          hooks = JSON.parse(await box.read("project/.codex/hooks.json")).hooks;
        },
        t,
      );
      for (const directory of ["project", "project/src"])
        await test(
          `record from ${directory} with a clean environment`,
          async (t) => {
            const result = invoke("SessionStart", box.path(directory), {
              session_id: directory,
              cwd: box.path("project"),
              hook_event_name: "SessionStart",
              source: "startup",
            });
            t.assert.equal(result.status, 0, result.stderr);
            t.assert.equal(result.stderr, "");
            const events = (
              await box.read(
                "project/vouch/intents/clean-root/audit/events.jsonl",
              )
            )
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line));
            t.assert.equal(
              events.some(
                (event) =>
                  event.type === "session.started" &&
                  event.session === directory,
              ),
              true,
            );
          },
          t,
        );
      await test(
        "the guard also runs from a subdirectory without root variables",
        async (t) => {
          const before = await box.read(
            "project/vouch/intents/clean-root/audit/events.jsonl",
          );
          const result = invoke("PreToolUse", box.path("project/src"), {
            session_id: "guard",
            cwd: box.path("project"),
            hook_event_name: "PreToolUse",
            tool_name: "apply_patch",
            tool_input: {
              command:
                "*** Begin Patch\n*** Update File: vouch/intents/clean-root/audit/events.jsonl\n+forged\n*** End Patch",
            },
          });
          t.assert.equal(result.status, 2, result.stderr);
          t.assert.match(result.stderr, /VOUCH-GUARD-AUDIT/);
          t.assert.equal(
            await box.read(
              "project/vouch/intents/clean-root/audit/events.jsonl",
            ),
            before,
          );
        },
        t,
      );
    },
  );
