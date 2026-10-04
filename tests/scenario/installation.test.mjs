import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { windowsShell } from "../../scripts/lib/powershell.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { cursorInput, distribution, installRun } from "../helpers/install.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex", "cursor"]) {
  for (const scope of ["project", "user"]) {
    test(`${harness}/${scope}: installation, activation, local recording and removal`, async (t) => {
      const box = await sandbox(t);
      await mkdir(box.path("project"), { recursive: true });
      await box.write("project/AGENTS.md", "# Existing project guidance\n");
      await box.write("project/vouch/rules.md", "keep existing rules\n");
      distribution(t, box);
      const installed = installRun("install", box, harness, scope);
      t.assert.equal(installed.status, 0, installed.stdout + installed.stderr);
      const initial = JSON.parse(installed.stdout);
      t.assert.match(initial.digest, /^[a-f0-9]{64}$/);
      const init = installRun("init", box, harness, scope, [
        "--intent",
        "scope-test",
      ]);
      t.assert.equal(init.status, 0, init.stdout + init.stderr);
      const configuration = JSON.parse(
        await box.read("project/vouch/config.json"),
      );
      t.assert.equal(configuration.harnesses[harness].scope, scope);
      const payload =
        harness === "cursor"
          ? cursorInput(box.path("project"), "sessionStart")
          : {
              hook_event_name: "SessionStart",
              session_id: "synthetic-session",
              cwd: box.path("project"),
              source: "startup",
            };
      const recorded = spawnSync(
        process.execPath,
        [
          join(initial.runtimeRoot, "hooks/vouch-launch.mjs"),
          "session",
          "project",
          box.path("project"),
        ],
        { input: JSON.stringify(payload), encoding: "utf8", timeout: 4000 },
      );
      t.assert.equal(recorded.status, 0, recorded.stderr);
      const events = (
        await box.read("project/vouch/intents/scope-test/audit/events.jsonl")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      t.assert.equal(events.length, 1);
      t.assert.equal(events[0].harness, harness);
      if (harness === "claude") {
        const { statusLine } = JSON.parse(
          await box.read("project/.claude/settings.json"),
        );
        t.assert.equal(statusLine.type, "command");
        t.assert.match(statusLine.command, /vouch-launch\.mjs.*statusline/);
        const display = spawnSync(
          process.platform === "win32" ? windowsShell() : "sh",
          process.platform === "win32"
            ? ["-NoProfile", "-Command", statusLine.command]
            : ["-c", statusLine.command],
          {
            cwd: box.path("project"),
            env: {
              ...process.env,
              CLAUDE_PROJECT_DIR: box.path("project"),
              VOUCH_INTENT: "unselected",
            },
            encoding: "utf8",
            timeout: 4000,
          },
        );
        t.assert.equal(display.status, 0, display.stderr);
        t.assert.match(display.stdout, /scope-test/);
        t.assert.equal(
          await box.read("project/vouch/intents/scope-test/audit/events.jsonl"),
          events.map((event) => JSON.stringify(event)).join("\n") + "\n",
        );
      }
      const doctor = installRun("doctor", box, harness, scope);
      t.assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
      t.assert.equal(
        JSON.parse(doctor.stdout).runtimeRoot,
        initial.runtimeRoot,
      );
      const removed = installRun("remove", box, harness, scope);
      t.assert.equal(removed.status, 0, removed.stdout + removed.stderr);
      t.assert.equal(
        await box.read("project/vouch/rules.md"),
        "keep existing rules\n",
      );
      t.assert.match(
        await box.read("project/AGENTS.md"),
        /^# Existing project guidance\n/,
      );
      t.assert.equal(
        await readFile(
          box.path("project/vouch/intents/scope-test/audit/events.jsonl"),
          "utf8",
        ),
        events.map((event) => JSON.stringify(event)).join("\n") + "\n",
      );
    });
  }
}
