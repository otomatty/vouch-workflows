import { spawnSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test as group } from "node:test";
import { windowsShell } from "../../scripts/lib/powershell.mjs";
import { hookTest as test } from "./hook-test.mjs";
import { cursorInput, distribution, installRun } from "./install.mjs";
import { sandbox } from "./runtime.mjs";

/** @param {"claude"|"codex"|"cursor"} harness */
export function installationSelection(harness) {
  group(
    `${harness}: user update preserves project pins, project install takes precedence and duplicate hooks skip`,
    async (t) => {
      const box = await sandbox(t);
      let old = { runtimeRoot: "", digest: "" };
      let next = { runtimeRoot: "", digest: "" };
      await test(
        "install the user runtime and pin the project",
        async (t) => {
          await mkdir(box.path("project/src"), { recursive: true });
          distribution(t, box);
          const user = installRun("install", box, harness, "user");
          t.assert.equal(user.status, 0, user.stdout);
          old = JSON.parse(user.stdout);
          t.assert.equal(
            installRun("init", box, harness, "user", ["--intent", "first"])
              .status,
            0,
          );
        },
        t,
      );
      await test(
        "update the user runtime without changing the project pin",
        async (t) => {
          await box.write(
            `dist/${harness}/AGENTS.md`,
            `${await box.read(`dist/${harness}/AGENTS.md`)}\nSynthetic next distribution.\n`,
          );
          const updated = installRun("update", box, harness, "user");
          t.assert.equal(updated.status, 0, updated.stdout);
          next = JSON.parse(updated.stdout);
          t.assert.notEqual(next.digest, old.digest);
          const doctor = installRun("doctor", box, harness, "user");
          t.assert.equal(doctor.status, 0, doctor.stdout);
          t.assert.equal(JSON.parse(doctor.stdout).digest, old.digest);
        },
        t,
      );
      let events = "";
      await test(
        "skip global duplicates and reject a payload project mismatch",
        async (t) => {
          const payload =
            harness === "cursor"
              ? cursorInput(box.path("other-project"), "sessionStart")
              : {
                  hook_event_name: "SessionStart",
                  session_id: "one",
                  cwd: box.path("other-project"),
                  source: "startup",
                };
          /** @param {string} runtime @param {string} scope */
          const run = (runtime, scope) =>
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
                env: {
                  ...process.env,
                  VOUCH_PROJECT_ROOT: box.path("project"),
                  VOUCH_INTENT: "unselected",
                },
                input: JSON.stringify(payload),
                encoding: "utf8",
              },
            );
          for (const runtime of [old.runtimeRoot, next.runtimeRoot]) {
            const skipped = run(runtime, "user");
            t.assert.equal(skipped.status, 0, skipped.stderr);
            t.assert.equal(skipped.stderr, "");
          }
          t.assert.equal(run(old.runtimeRoot, "project").status, 0);
          await t.assert.rejects(
            box.read("project/vouch/intents/first/audit/events.jsonl"),
            /ENOENT/,
          );
          payload.cwd = box.path("project");
          t.assert.equal(run(old.runtimeRoot, "project").status, 0);
          events = await box.read(
            "project/vouch/intents/first/audit/events.jsonl",
          );
          t.assert.equal(events.trim().split("\n").length, 1);
        },
        t,
      );
      await test(
        "prefer the project runtime and preserve the user installation after disconnecting",
        async (t) => {
          const local = installRun("install", box, harness, "project");
          t.assert.equal(local.status, 0, local.stdout);
          t.assert.equal(installRun("init", box, harness, "user").status, 0);
          const config = JSON.parse(
            await box.read("project/vouch/config.json"),
          );
          t.assert.equal(config.harnesses[harness].scope, "project");
          t.assert.equal(config.harnesses[harness].digest, next.digest);
          t.assert.equal(
            await box.read("project/vouch/intents/first/audit/events.jsonl"),
            events,
          );
          t.assert.equal(
            installRun("remove", box, harness, "project").status,
            0,
          );
          t.assert.equal(installRun("init", box, harness, "user").status, 0);
          t.assert.equal(
            JSON.parse(await box.read("project/vouch/config.json")).harnesses[
              harness
            ].scope,
            "user",
          );
          t.assert.equal(
            installRun("remove", box, harness, "project").status,
            0,
          );
          t.assert.equal(
            JSON.parse(
              await box.read(`home/.vouch/installations/${harness}.json`),
            ).digest,
            next.digest,
          );
          t.assert.equal(
            JSON.parse(await box.read("project/vouch/config.json")).harnesses[
              harness
            ],
            undefined,
          );
        },
        t,
      );
    },
  );
  test(`${harness}: project installation remains usable after moving the checkout`, async (t) => {
    const box = await sandbox(t);
    await mkdir(box.path("project"));
    distribution(t, box);
    t.assert.equal(
      installRun("install", box, harness, "project", ["--intent", "moved"])
        .status,
      0,
    );
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
    if (harness === "cursor") {
      for (const hooks of Object.values(native.hooks))
        for (const item of /** @type {{command:string}[]} */ (hooks))
          t.assert.match(
            item.command,
            /^node \.vouch\/versions\/[a-f0-9]{64}\/cursor\/hooks\/vouch-launch\.mjs (session|prompt|guard|stop) project \.$/,
          );
    }
    if (harness === "claude")
      t.assert.match(
        native.statusLine.command,
        /^node \.vouch\/versions\/[a-f0-9]{64}\/claude\/hooks\/vouch-launch\.mjs statusline project \.$/,
      );
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
          ? windowsShell()
          : "/bin/sh",
      harness === "claude"
        ? hook.args.map((/** @type {string} */ arg) =>
            arg.replaceAll(`\${${variable}}`, root),
          )
        : process.platform === "win32"
          ? ["-NoProfile", "-Command", hook.commandWindows ?? hook.command]
          : ["-c", hook.command],
      {
        cwd: root,
        env: {
          ...process.env,
          [variable]: root,
          ...(harness === "cursor" ? { VOUCH_PROJECT_ROOT: box.root } : {}),
        },
        input: JSON.stringify(input),
        encoding: "utf8",
      },
    );
    t.assert.equal(result.status, 0, result.stderr);
    t.assert.equal(result.stderr, "");
    t.assert.equal(config.harnesses[harness].scope, "project");
    const recorded = JSON.parse(
      (
        await box.read(
          "moved 日本語 $ apostrophe'/vouch/intents/moved/audit/events.jsonl",
        )
      ).trim(),
    );
    t.assert.equal(recorded.harness, harness);
    t.assert.equal(recorded.intent, "moved");
  });
}
