import { spawnSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cursorInput, distribution, installRun } from "../helpers/install.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex", "cursor"]) {
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
}
test("installation refuses roots its commands cannot quote in every shell", (t) => {
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
      "cursor",
      "user",
    );
    t.assert.equal(refused.status, 2, name);
    t.assert.match(refused.stdout, /INSTALL-PATH/, name);
  }
});
