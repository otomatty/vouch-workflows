import { spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { artifact, audit, intent, planned, topics } from "./intent-review.mjs";
import { packageRun } from "./packaging.mjs";
import { capturedPrompt, sandbox } from "./runtime.mjs";
import { toolFixture } from "./write-guard.mjs";

/** @typedef {{command:string,args?:string[],commandWindows?:string}} Registered */

/**
 * Run a copied registration as the harness would; the caller names the other harness.
 * @param {'claude'|'codex'} harness @param {Registered} registered @param {string} root
 * @param {object} payload @param {Record<string,string>} env
 */
function invoke(harness, registered, root, payload, env) {
  const windows = process.platform === "win32";
  const [exe, args] =
    harness === "claude"
      ? [
          registered.command,
          (registered.args ?? []).map((value) =>
            value.replaceAll(`\${CLAUDE_PROJECT_DIR}`, root),
          ),
        ]
      : windows
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
    // The registration's own environment wins, as the harness applies it.
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      VOUCH_PROJECT_ROOT: root,
      VOUCH_HARNESS: harness === "claude" ? "codex" : "claude",
      VOUCH_INTENT: intent,
      VOUCH_TEST_TIME: "2026-09-27T00:00:00.000Z",
      NODE_OPTIONS: `--import="${pathToFileURL(resolve("tests/helpers/fixed-clock.mjs")).href}"`,
      ...env,
    },
  });
}

/**
 * Copied registrations confirm, apply the approval and then admit implementation writes.
 * One harness per test file keeps Node 22's five-second file limit (docs/development/approval-boundary.md).
 * @param {import('node:test').TestContext} t @param {'claude'|'codex'} harness
 */
export async function exerciseApprovalDistribution(t, harness) {
  const box = await sandbox(t);
  const folder = "日本語 project $ apostrophe'";
  const root = box.path(folder);
  const home = `.${harness}`;
  t.plan(8);
  t.assert.equal(packageRun(["--out", box.path("dist")]).status, 0);
  await cp(box.path(`dist/${harness}`), root, { recursive: true });
  await box.write(`${folder}/${artifact}`, planned());
  const settings = JSON.parse(
    await box.read(
      `${folder}/${home}/${harness === "claude" ? "settings" : "hooks"}.json`,
    ),
  );
  const env = settings.env ?? {};
  const prompt = settings.hooks.UserPromptSubmit[0].hooks[0];
  const guard = settings.hooks.PreToolUse[0].hooks[0];
  const field = harness === "claude" ? "prompt_id" : "turn_id";
  let count = 0;
  /** @param {string} text */
  const send = (text) =>
    invoke(
      harness,
      prompt,
      root,
      {
        ...capturedPrompt(harness).payload,
        cwd: root,
        prompt: text,
        [field]: `synthetic-${++count}`,
      },
      env,
    );
  const write = () =>
    invoke(
      harness,
      guard,
      root,
      harness === "claude"
        ? toolFixture("claude", "Write", root, {
            file_path: `${root}/src/app.js`,
            content: "x\n",
          }).payload
        : toolFixture("codex", "apply_patch", root, {
            command:
              "*** Begin Patch\n*** Add File: src/app.js\n+x\n*** End Patch\n",
          }).payload,
      env,
    );
  const before = write();
  const recorded = [
    ...topics.map((target) => send(`vouch confirm ${target}`)),
    send("vouch review"),
  ];
  const rows = () =>
    box.read(`${folder}/${audit}`).then((text) =>
      text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    );
  const gate = (await rows()).find((row) => row.type === "gate.opened");
  const approved = send(`vouch approve ${gate?.id}`);
  const after = write();
  t.assert.deepEqual(
    [before.status, /^VOUCH-BUILD-UNAPPROVED: /.test(before.stderr)],
    [2, true],
  );
  t.assert.deepEqual(
    recorded.map((result) => result.status),
    [2, 2, 2, 2],
  );
  t.assert.equal(approved.status, 2, approved.stderr);
  t.assert.match(approved.stderr, /VOUCH-APPROVAL-APPLIED/);
  t.assert.equal(
    await box.read(`${folder}/${artifact}`),
    planned().replace("status: draft", "status: approved"),
  );
  t.assert.deepEqual(
    (await rows()).map((row) => [row.type, row.harness]),
    [
      ["checkpoint.confirmed", harness],
      ["checkpoint.confirmed", harness],
      ["checkpoint.confirmed", harness],
      ["gate.opened", harness],
      ["intent.approved", harness],
    ],
  );
  t.assert.deepEqual([after.status, after.stderr], [0, ""]);
}
