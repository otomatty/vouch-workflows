import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { packageRun } from "./packaging.mjs";

/** @param {import('node:test').TestContext} t @param {Awaited<ReturnType<import('./runtime.mjs').sandbox>>} box */
export function distribution(t, box) {
  const result = packageRun(["--out", box.path("dist")]);
  t.assert.equal(result.status, 0, result.stderr);
}

/** @param {string} command @param {Awaited<ReturnType<import('./runtime.mjs').sandbox>>} box
 * @param {string} harness @param {string} scope @param {string[]} [extra] */
export function installRun(command, box, harness, scope, extra = []) {
  return spawnSync(
    process.execPath,
    [
      resolve("scripts/vouch.mjs"),
      command,
      "--harness",
      harness,
      "--scope",
      scope,
      "--home",
      box.path("home"),
      "--project",
      box.path("project"),
      "--dist",
      box.path("dist"),
      ...extra,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    },
  );
}

/** Documented input shapes, synthetic; no claim of a native Cursor capture.
 * @param {string} root @param {string} event @param {Record<string,unknown>} [fields] */
export const cursorInput = (root, event, fields = {}) => ({
  hook_event_name: event,
  conversation_id: "synthetic-conversation",
  generation_id: "synthetic-generation",
  workspace_roots: [root],
  cwd: root,
  ...fields,
});
