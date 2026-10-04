import { spawnSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  test(`${harness}: project hooks and manual commands find the moved checkout from a subdirectory without variables`, async (t) => {
    const box = await sandbox(t);
    await mkdir(box.path("project"));
    distribution(t, box);
    const installed = installRun("install", box, harness, "project", [
      "--intent",
      "moved",
    ]);
    t.assert.equal(installed.status, 0, installed.stdout);
    const root = box.path("moved 日本語 $ apostrophe'");
    await cp(box.path("project"), root, { recursive: true });
    await mkdir(join(root, "src/deep"), { recursive: true });
    const moved = installRun("doctor", box, harness, "project", [
      "--project",
      root,
    ]);
    t.assert.equal(moved.status, 0, moved.stdout);
    const native = JSON.parse(
      await box.read(
        `moved 日本語 $ apostrophe'/.${harness}/${harness === "claude" ? "settings" : "hooks"}.json`,
      ),
    );
    const hook =
      harness === "cursor"
        ? native.hooks.sessionStart[0]
        : native.hooks.SessionStart[0].hooks[0];
    // Design D6: one shell-neutral command; only Claude expands its own variable in args.
    if (harness !== "claude")
      t.assert.doesNotMatch(
        hook.command,
        /\$\{|\$env:|%[A-Z_]+%|^&/,
        "no shell variables",
      );
    const cwd = join(root, "src/deep");
    const input =
      harness === "cursor"
        ? cursorInput(cwd, "sessionStart")
        : {
            hook_event_name: "SessionStart",
            session_id: "moved",
            cwd,
            source: "startup",
          };
    const shell = (command: string) =>
      process.platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-Command", command]]
        : ["/bin/sh", ["-c", command]];
    const env = { ...process.env };
    for (const name of [
      "VOUCH_PROJECT_ROOT",
      "CLAUDE_PROJECT_DIR",
      "CURSOR_PROJECT_DIR",
      "VOUCH_INTENT",
    ])
      delete env[name];
    const [program, args] =
      harness === "claude"
        ? [
            process.execPath,
            hook.args.map((arg: string) =>
              arg.replaceAll(`\${CLAUDE_PROJECT_DIR}`, root),
            ),
          ]
        : shell(
            process.platform === "win32" && hook.commandWindows
              ? hook.commandWindows
              : hook.command,
          );
    const result = spawnSync(program as string, args as string[], {
      cwd,
      env,
      input: JSON.stringify(input),
      encoding: "utf8",
    });
    t.assert.equal(result.status, 0, result.stderr);
    t.assert.equal(result.stderr, "");
    const events = (
      await box.read(
        "moved 日本語 $ apostrophe'/vouch/intents/moved/audit/events.jsonl",
      )
    )
      .trim()
      .split("\n");
    t.assert.equal(events.length, 1);
    // The manual doctor command from the installed Skill runs from the same subdirectory.
    const skill = await box.read(
      `moved 日本語 $ apostrophe'/${harness === "codex" ? ".agents" : `.${harness}`}/skills/vouch/references/doctor.md`,
    );
    const command = /^(node .*doctor manual)$/m.exec(skill)?.[1];
    t.assert.equal(typeof command, "string", "doctor command");
    const [manual, words] = shell(command as string);
    const doctor = spawnSync(manual as string, words as string[], {
      cwd,
      env,
      encoding: "utf8",
    });
    t.assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  });
  test(`${harness}: installation refuses roots its commands cannot quote in every shell`, (t) => {
    for (const name of [
      'home "quoted"',
      "home $dollar",
      "home `tick`",
      "home %VAR%",
    ]) {
      const box = { path: (path: string) => join(tmpdir(), name, path) };
      const refused = installRun(
        "install",
        box as Parameters<typeof installRun>[1],
        harness,
        "user",
      );
      t.assert.equal(refused.status, 2, name);
      t.assert.match(refused.stdout, /INSTALL-PATH/, name);
    }
  });
}
