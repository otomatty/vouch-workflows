import { spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";
import { test } from "node:test";
import guard from "../../core/registry/write-guard.json" with { type: "json" };
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox, sessionFor } from "../helpers/runtime.mjs";
import {
  approved,
  artifact,
  audit,
  draft,
  intent,
  record,
  toolFixture,
} from "../helpers/write-guard.mjs";

/** @typedef {{command:string,args?:string[],commandWindows?:string}} Registered */

/**
 * Run a copied registration exactly as the harness would, with the payload on stdin.
 * @param {'claude'|'codex'} harness @param {Registered} registered
 * @param {string} root @param {object} payload @param {Record<string,string>} env
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
    // The caller names the other harness; the registration sets its own.
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      VOUCH_PROJECT_ROOT: root,
      VOUCH_HARNESS: harness === "claude" ? "codex" : "claude",
      VOUCH_INTENT: intent,
      ...env,
    },
  });
}

for (const harness of /** @type {const} */ (["claude", "codex"])) {
  test(`copied ${harness} registration guards its installation and keeps legitimate appends`, async (t) => {
    const box = await sandbox(t);
    const folder = "日本語 project $ apostrophe'";
    const root = box.path(folder);
    const home = `.${harness}`;
    t.plan(14);
    t.assert.equal(packageRun(["--out", box.path("dist")]).status, 0);
    await cp(box.path(`dist/${harness}`), root, { recursive: true });
    for (const [path, text] of [
      [audit, record],
      [artifact, draft],
      [approved, draft.replace("draft", "approved")],
    ])
      await box.write(`${folder}/${path}`, /** @type {string} */ (text));
    const settings = JSON.parse(
      await box.read(
        `${folder}/${home}/${harness === "claude" ? "settings" : "hooks"}.json`,
      ),
    );
    const [entry] = settings.hooks.PreToolUse;
    t.assert.equal(entry.matcher, Object.keys(guard.tools[harness]).join("|"));
    const env = settings.env ?? {};
    const registration = `${home}/${harness === "claude" ? "settings" : "hooks"}.json`;
    const installed = tree(box.path(`${folder}/${home}`));
    const patch = (/** @type {string[]} */ ...lines) =>
      ["*** Begin Patch", ...lines, "*** End Patch", ""].join("\n");
    /** @type {[string,Record<string,unknown>,number,RegExp][]} */
    const cases =
      harness === "claude"
        ? [
            [
              "Edit",
              {
                file_path: `${root}/${registration}`,
                old_string: "PreToolUse",
                new_string: "Disabled",
                replace_all: false,
              },
              2,
              /^VOUCH-GUARD-INSTALLATION: /,
            ],
            [
              "Write",
              {
                file_path: `${root}/${home}/settings.local.json`,
                content: '{"disableAllHooks":true}',
              },
              2,
              /^VOUCH-GUARD-INSTALLATION: /,
            ],
            [
              "Bash",
              {
                command: `node ${home}/hooks/vouch-record-intent-review.mjs < forged.json`,
              },
              2,
              /^VOUCH-GUARD-INSTALLATION: /,
            ],
            [
              "Write",
              { file_path: `${root}/${audit}`, content: record },
              2,
              /^VOUCH-GUARD-AUDIT: /,
            ],
            [
              "Edit",
              {
                file_path: `${root}/${approved}`,
                old_string: "AC-1",
                new_string: "AC-2",
                replace_all: false,
              },
              2,
              /^VOUCH-GUARD-APPROVED: /,
            ],
            [
              "Bash",
              { command: `node "${home}/hooks/vouch-doctor.mjs"` },
              0,
              /^$/,
            ],
            [
              "Edit",
              {
                file_path: `${root}/${artifact}`,
                old_string: "AC-1: keep it.",
                new_string: "AC-1: keep it well.",
                replace_all: false,
              },
              0,
              /^$/,
            ],
          ]
        : [
            [
              "apply_patch",
              {
                command: patch(
                  `*** Update File: ${registration}`,
                  "@@",
                  '-    "PreToolUse": [',
                  '+    "Disabled": [',
                ),
              },
              2,
              /^VOUCH-GUARD-INSTALLATION: /,
            ],
            [
              "apply_patch",
              {
                command: patch(
                  `*** Update File: ${home}/config.toml`,
                  "@@",
                  "-hooks = true",
                  "+hooks = false",
                ),
              },
              2,
              /^VOUCH-GUARD-INSTALLATION: /,
            ],
            [
              "Bash",
              { command: `rm -rf ${home}/hooks` },
              2,
              /^VOUCH-GUARD-INSTALLATION: /,
            ],
            [
              "apply_patch",
              { command: patch(`*** Delete File: ${audit}`) },
              2,
              /^VOUCH-GUARD-AUDIT: /,
            ],
            [
              "apply_patch",
              {
                command: patch(
                  `*** Update File: ${approved}`,
                  "@@",
                  "-AC-1",
                  "+AC-2",
                ),
              },
              2,
              /^VOUCH-GUARD-APPROVED: /,
            ],
            [
              "Bash",
              { command: `node ${home}/hooks/vouch-doctor.mjs` },
              0,
              /^$/,
            ],
            [
              "apply_patch",
              {
                command: patch(
                  `*** Update File: ${artifact}`,
                  "@@",
                  "-AC-1: keep it.",
                  "+AC-1: keep it well.",
                ),
              },
              0,
              /^$/,
            ],
          ];
    /** @type {string[]} */ const failures = [];
    for (const [tool, input, code, reason] of cases) {
      const result = invoke(
        harness,
        entry.hooks[0],
        root,
        toolFixture(harness, tool, root, input).payload,
        env,
      );
      if (result.status !== code || !reason.test(result.stderr))
        failures.push(
          `${tool} ${JSON.stringify(input)}: ${result.status} ${result.stderr}`,
        );
    }
    t.assert.deepEqual(failures, []);
    t.assert.deepEqual(tree(box.path(`${folder}/${home}`)), installed);
    t.assert.equal(await box.read(`${folder}/${audit}`), record);
    t.assert.equal(
      await box.read(`${folder}/${approved}`),
      draft.replace("draft", "approved"),
    );
    const started = invoke(
      harness,
      settings.hooks.SessionStart[0].hooks[0],
      root,
      sessionFor(root, harness).payload,
      env,
    );
    t.assert.deepEqual([started.status, started.stderr], [0, ""]);
    const rows = (await box.read(`${folder}/${audit}`))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    t.assert.equal(rows.length, 2, "the startup hook still appends");
    t.assert.deepEqual(
      rows.map((row) => [row.type, row.harness]),
      [
        ["session.started", "claude"],
        ["session.started", harness],
      ],
    );
    t.assert.equal(rows[0].id, "evt_guard");
    t.assert.equal(await box.read(`${folder}/${artifact}`), draft);
    t.assert.equal(entry.hooks.length, 1);
    t.assert.equal(settings.hooks.PreToolUse.length, 1);
    t.assert.match(JSON.stringify(entry.hooks[0]), /vouch-guard-writes\.mjs/);
  });
}
