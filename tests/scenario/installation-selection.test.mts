import { spawnSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { cursorInput, distribution, installRun } from "../helpers/install.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex", "cursor"]) {
  test(`${harness}: user update preserves project pins and a project install takes precedence`, async (t) => {
    const box = await sandbox(t);
    await mkdir(box.path("project/src"), { recursive: true });
    distribution(t, box);
    const user = installRun("install", box, harness, "user");
    t.assert.equal(user.status, 0, user.stdout);
    const old = JSON.parse(user.stdout);
    t.assert.equal(
      installRun("init", box, harness, "user", ["--intent", "first"]).status,
      0,
    );
    await box.write(
      `dist/${harness}/AGENTS.md`,
      `${await box.read(`dist/${harness}/AGENTS.md`)}\nSynthetic next distribution.\n`,
    );
    const updated = installRun("update", box, harness, "user");
    t.assert.equal(updated.status, 0, updated.stdout);
    const next = JSON.parse(updated.stdout);
    t.assert.notEqual(next.digest, old.digest);
    const doctor = installRun("doctor", box, harness, "user");
    t.assert.equal(doctor.status, 0, doctor.stdout);
    t.assert.equal(JSON.parse(doctor.stdout).digest, old.digest);
    const payload =
      harness === "cursor"
        ? cursorInput(box.path("other-project"), "sessionStart")
        : {
            hook_event_name: "SessionStart",
            session_id: "one",
            cwd: box.path("other-project"),
            source: "startup",
          };
    const run = (runtime: string, scope: string) =>
      spawnSync(
        process.execPath,
        [
          join(runtime, "hooks/vouch-launch.mjs"),
          "session",
          scope,
          ...(scope === "project" ? [box.path("project")] : []),
        ],
        {
          cwd: box.path("project/src"),
          env: { ...process.env, VOUCH_PROJECT_ROOT: box.path("project") },
          input: JSON.stringify(payload),
          encoding: "utf8",
        },
      );
    t.assert.equal(run(old.runtimeRoot, "project").status, 0);
    await t.assert.rejects(
      box.read("project/vouch/intents/first/audit/events.jsonl"),
      /ENOENT/,
    );
    payload.cwd = box.path("project");
    t.assert.equal(run(old.runtimeRoot, "project").status, 0);
    const events = await box.read(
      "project/vouch/intents/first/audit/events.jsonl",
    );
    t.assert.equal(events.trim().split("\n").length, 1);
    const local = installRun("install", box, harness, "project");
    t.assert.equal(local.status, 0, local.stdout);
    t.assert.equal(installRun("init", box, harness, "user").status, 0);
    const config = JSON.parse(await box.read("project/vouch/config.json"));
    t.assert.equal(config.harnesses[harness].scope, "project");
    t.assert.equal(config.harnesses[harness].digest, next.digest);
    t.assert.equal(
      await box.read("project/vouch/intents/first/audit/events.jsonl"),
      events,
    );
    t.assert.equal(installRun("remove", box, harness, "project").status, 0);
    t.assert.equal(installRun("init", box, harness, "user").status, 0);
    t.assert.equal(
      JSON.parse(await box.read("project/vouch/config.json")).harnesses[harness]
        .scope,
      "user",
    );
    t.assert.equal(installRun("remove", box, harness, "project").status, 0);
    t.assert.equal(
      JSON.parse(await box.read(`home/.vouch/installations/${harness}.json`))
        .digest,
      next.digest,
    );
    t.assert.equal(
      JSON.parse(await box.read("project/vouch/config.json")).harnesses[
        harness
      ],
      undefined,
    );
  });
  test(`${harness}: project installation remains usable after moving the checkout`, async (t) => {
    const box = await sandbox(t);
    await mkdir(box.path("project"));
    distribution(t, box);
    t.assert.equal(installRun("install", box, harness, "project").status, 0);
    await cp(box.path("project"), box.path("moved 日本語 $ apostrophe'"), {
      recursive: true,
    });
    const moved = installRun("doctor", box, harness, "project", [
      "--project",
      box.path("moved 日本語 $ apostrophe'"),
    ]);
    t.assert.equal(moved.status, 0, moved.stdout);
    const config = JSON.parse(
      await box.read("moved 日本語 $ apostrophe'/vouch/config.json"),
    );
    const native = JSON.parse(
      await box.read(
        `moved 日本語 $ apostrophe'/.${harness}/${harness === "claude" ? "settings" : "hooks"}.json`,
      ),
    );
    const hook =
      harness === "cursor"
        ? native.hooks.sessionStart[0]
        : native.hooks.SessionStart[0].hooks[0];
    const variable =
      harness === "claude"
        ? "CLAUDE_PROJECT_DIR"
        : harness === "cursor"
          ? "CURSOR_PROJECT_DIR"
          : "VOUCH_PROJECT_ROOT";
    const root = box.path("moved 日本語 $ apostrophe'");
    const input =
      harness === "cursor"
        ? cursorInput(root, "sessionStart")
        : {
            hook_event_name: "SessionStart",
            session_id: "moved",
            cwd: root,
            source: "startup",
          };
    const result = spawnSync(
      harness === "claude"
        ? process.execPath
        : process.platform === "win32"
          ? "powershell.exe"
          : "/bin/sh",
      harness === "claude"
        ? hook.args.map((arg: string) =>
            arg.replaceAll(`\${${variable}}`, root),
          )
        : process.platform === "win32"
          ? ["-NoProfile", "-Command", hook.commandWindows ?? hook.command]
          : ["-c", hook.command],
      {
        cwd: root,
        env: { ...process.env, [variable]: root },
        input: JSON.stringify(input),
        encoding: "utf8",
      },
    );
    t.assert.equal(result.status, 0, result.stderr);
    t.assert.equal(result.stderr, "");
    t.assert.equal(config.harnesses[harness].scope, "project");
  });
}
