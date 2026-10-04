import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { packageRun } from "./packaging.mjs";

export function distribution(
  t: import("node:test").TestContext,
  box: Awaited<ReturnType<typeof import("./runtime.mjs").sandbox>>,
) {
  const result = packageRun(["--out", box.path("dist")]);
  t.assert.equal(result.status, 0, result.stderr);
}

export function installRun(
  command: string,
  box: Awaited<ReturnType<typeof import("./runtime.mjs").sandbox>>,
  harness: string,
  scope: string,
  extra: string[] = [],
) {
  return spawnSync(
    process.execPath,
    [
      resolve("scripts/vouch.mjs"),
      command,
      "--harness",
      harness,
      "--scope",
      scope,
      ...(!extra.includes("--home") ? ["--home", box.path("home")] : []),
      ...(!extra.includes("--project")
        ? ["--project", box.path("project")]
        : []),
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

/** Documented input shapes, synthetic; no claim of a native Cursor capture. */
export const cursorInput = (
  root: string,
  event: string,
  fields: Record<string, unknown> = {},
) => ({
  hook_event_name: event,
  conversation_id: "synthetic-conversation",
  generation_id: "synthetic-generation",
  workspace_roots: [root],
  cwd: root,
  ...fields,
});
