import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Run a source command entry. Its project is this repository, found from the entry's location,
 * which has no Intent; the input is not a hook event.
 * @param {string} entry @param {string[]} [args] @param {Record<string,string>} [env]
 */
export function source(entry, args = [], env = {}) {
  return spawnSync(
    process.execPath,
    [resolve(`core/hooks/${entry}.mjs`), ...args],
    {
      cwd: process.cwd(),
      input: "not a hook event",
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
      env: { ...process.env, VOUCH_INTENT: "", ...env },
    },
  );
}
