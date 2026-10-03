import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { packageRun } from "./packaging.mjs";

/** One generated snapshot per isolated test process; each sandbox gets independent bytes.
 * Packaging itself has its own tests. Installation tests keep invoking the real installer.
 * @type {Map<string,Buffer>|undefined} */
let packaged;

/** @param {import('node:test').TestContext} t @param {Awaited<ReturnType<import('./runtime.mjs').sandbox>>} box */
export function distribution(t, box) {
  const root = box.path("dist");
  if (packaged) {
    const directories = new Set();
    for (const [path, bytes] of packaged) {
      const target = join(root, path);
      const directory = dirname(target);
      if (!directories.has(directory)) {
        mkdirSync(directory, { recursive: true });
        directories.add(directory);
      }
      writeFileSync(target, bytes);
    }
    return;
  }
  const result = packageRun(["--out", box.path("dist")]);
  t.assert.equal(result.status, 0, result.stderr);
  packaged = new Map(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [relative(root, path), readFileSync(path)];
      }),
  );
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
