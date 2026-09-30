import { execFileSync, spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { packageRun } from "../helpers/packaging.mjs";
import { validator } from "../helpers/registry.mjs";
import { sandbox } from "../helpers/runtime.mjs";
import { toolFixture } from "../helpers/write-guard.mjs";

// Installed Git guard and DoD command: docs/development/git-guard.md.
/** @typedef {{command:string,args?:string[],commandWindows?:string}} Registered */

/**
 * Run the copied PreToolUse registration as the harness would, with the payload on stdin.
 * @param {'claude'|'codex'} harness @param {Registered} registered @param {string} root
 * @param {object} payload
 */
function invoke(harness, registered, root, payload) {
  const [exe, args] =
    harness === "claude"
      ? [
          registered.command,
          (registered.args ?? []).map((value) =>
            value.replaceAll(`\${CLAUDE_PROJECT_DIR}`, root),
          ),
        ]
      : process.platform === "win32"
        ? [
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              registered.commandWindows ?? "",
            ],
          ]
        : ["/bin/sh", ["-c", registered.command]];
  return spawnSync(exe, args, {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
    windowsHide: true,
    timeout: 4000,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      VOUCH_PROJECT_ROOT: root,
      VOUCH_HARNESS: harness === "claude" ? "codex" : "claude",
      VOUCH_INTENT: "260929-installed",
    },
  });
}

for (const harness of /** @type {const} */ (["claude", "codex"])) {
  test(`copied ${harness} registration refuses a push to main and lets the DoD command run`, async (t) => {
    const box = await sandbox(t);
    const root = box.path("日本語 project $ apostrophe'");
    const home = `.${harness}`;
    t.plan(7);
    t.assert.equal(packageRun(["--out", box.path("dist")]).status, 0);
    await cp(box.path(`dist/${harness}`), root, { recursive: true });
    execFileSync("git", ["init", "-q", "--initial-branch=main", root], {
      windowsHide: true,
    });
    const settings = JSON.parse(
      await box.read(
        `日本語 project $ apostrophe'/${home}/${harness === "claude" ? "settings" : "hooks"}.json`,
      ),
    );
    const [registered] = settings.hooks.PreToolUse[0].hooks;
    /** @param {string} command */
    const run = (command) =>
      invoke(
        harness,
        registered,
        root,
        toolFixture(harness, "Bash", root, { command }).payload,
      );
    const denied = run("git push -u origin HEAD:main");
    t.assert.equal(denied.status, 2);
    t.assert.match(
      denied.stderr,
      /^VOUCH-GIT-PUSH: Bash git push -u origin HEAD:main; main is protected/,
    );
    // The allowed calls run the copied guard directly; PowerShell starts slowly on Windows.
    /** @param {string} command */
    const direct = (command) =>
      spawnSync(
        process.execPath,
        [join(root, home, "hooks/vouch-guard-writes.mjs")],
        {
          cwd: root,
          input: JSON.stringify(
            toolFixture(harness, "Bash", root, { command }).payload,
          ),
          encoding: "utf8",
          windowsHide: true,
          timeout: 4000,
          env: {
            ...process.env,
            VOUCH_PROJECT_ROOT: root,
            VOUCH_HARNESS: harness,
            VOUCH_INTENT: "260929-installed",
          },
        },
      );
    t.assert.deepEqual(
      [
        direct("git push -u origin vouch/260929-installed").status,
        direct(`node ${home}/hooks/vouch-dod.mjs`).status,
      ],
      [0, 0],
    );
    const dod = spawnSync(
      process.execPath,
      [join(root, home, "hooks/vouch-dod.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        env: { ...process.env, VOUCH_INTENT: "260929-installed" },
      },
    );
    const report = JSON.parse(dod.stdout);
    t.assert.equal(dod.status, 2);
    t.assert.equal(validator("doctor-report")(report), true);
    t.assert.deepEqual(
      report.checks.map((/** @type {{id:string}} */ item) => item.id),
      ["DOD-PLAN"],
    );
  });
}
