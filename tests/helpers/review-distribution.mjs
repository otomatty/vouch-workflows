import { spawnSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { windowsShell } from "../../scripts/lib/powershell.mjs";
import { artifact, audit, draft, intent } from "./intent-review.mjs";
import { packageRun } from "./packaging.mjs";
import { capturedPrompt, sandbox } from "./runtime.mjs";

/** @param {import('node:test').TestContext} t @param {'claude'|'codex'} harness */
export async function exerciseReviewDistribution(t, harness) {
  const box = await sandbox(t);
  const folder = "日本語 project $ apostrophe'";
  const root = box.path(folder);
  t.plan(8);
  t.assert.equal(packageRun(["--out", box.path("dist")]).status, 0);
  await cp(box.path(`dist/${harness}`), root, { recursive: true });
  await box.write(`${folder}/${artifact}`, draft);
  const nested = resolve(root, "nested");
  await mkdir(nested);
  const settings = JSON.parse(
    await box.read(
      `dist/${harness}/.${harness}/${harness === "claude" ? "settings" : "hooks"}.json`,
    ),
  );
  const command = settings.hooks.UserPromptSubmit[0].hooks[0];
  const reference = capturedPrompt(harness);
  const fixture = {
    ...reference,
    synthetic: true,
    provenance: "synthetic",
    payload: { ...reference.payload, cwd: nested },
  };
  t.assert.equal(fixture.synthetic, true);
  let prompt = "vouch review";
  for (const action of ["open", "approve"]) {
    const windows = process.platform === "win32";
    const exe =
      harness === "claude"
        ? process.execPath
        : windows
          ? windowsShell()
          : "/bin/sh";
    const args =
      harness === "claude"
        ? command.args.map((/** @type {string} */ value) =>
            value.replaceAll(`\${CLAUDE_PROJECT_DIR}`, root),
          )
        : windows
          ? [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              command.commandWindows,
            ]
          : ["-c", command.command];
    const result = spawnSync(exe, args, {
      cwd: nested,
      input: JSON.stringify({
        ...fixture.payload,
        prompt,
        [harness === "claude" ? "prompt_id" : "turn_id"]: `synthetic-${action}`,
      }),
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
      env: {
        ...process.env,
        ...settings.env,
        CLAUDE_PROJECT_DIR: root,
        VOUCH_PROJECT_ROOT: root,
        VOUCH_HARNESS: "claude",
        VOUCH_INTENT: intent,
        VOUCH_TEST_TIME: "2026-09-27T00:00:00.000Z",
        NODE_OPTIONS: `--import="${pathToFileURL(resolve("tests/helpers/fixed-clock.mjs")).href}"`,
      },
    });
    t.assert.equal(result.status, 2, result.stderr);
    t.assert.match(
      result.stderr,
      action === "open" ? /VOUCH-REVIEW-RECORDED/ : /VOUCH-APPROVAL-RECORDED/,
    );
    const [gate] = JSON.parse(
      `[${(await box.read(`${folder}/${audit}`)).trim().split("\n").join(",")}]`,
    );
    prompt = `vouch approve ${gate.id}`;
  }
  const rows = (await box.read(`${folder}/${audit}`))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  t.assert.deepEqual(
    rows.map((row) => [row.type, row.harness]),
    [
      ["gate.opened", harness],
      ["intent.approved", harness],
    ],
  );
  t.assert.equal(await box.read(`${folder}/${artifact}`), draft);
}
