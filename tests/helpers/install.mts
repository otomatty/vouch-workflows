import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packageRun } from "./packaging.mjs";

const selected = new WeakMap<object, string>();
let shared: string | undefined;

/** One generated distribution per test process; a test that edits it packages its own. */
export function distribution(
  t: import("node:test").TestContext,
  box: Awaited<ReturnType<typeof import("./runtime.mjs").sandbox>>,
  options: { own?: boolean } = {},
) {
  if (options.own) {
    const result = packageRun(["--out", box.path("dist")]);
    t.assert.equal(result.status, 0, result.stderr);
    return;
  }
  if (shared === undefined) {
    const directory = mkdtempSync(join(tmpdir(), "vouch-dist-"));
    process.once("exit", () =>
      rmSync(directory, { recursive: true, force: true }),
    );
    const result = packageRun(["--out", directory]);
    t.assert.equal(result.status, 0, result.stderr);
    shared = directory;
  }
  selected.set(box, shared);
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
      selected.get(box) ?? box.path("dist"),
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
