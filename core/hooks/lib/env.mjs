import { isAbsolute, resolve } from "node:path";
import { newId, now } from "./clock.mjs";

/** @param {Record<string,string|undefined>} [env] @returns {import('./contracts.mjs').HookContext} */
export function readContext(env = process.env) {
  const root = env.VOUCH_PROJECT_ROOT;
  const harness = env.VOUCH_HARNESS;
  if (
    !root ||
    !isAbsolute(root) ||
    (harness !== "claude" && harness !== "codex")
  ) {
    throw new Error(
      "ENV-CONFIG: absolute VOUCH_PROJECT_ROOT and known VOUCH_HARNESS required",
    );
  }
  return {
    projectRoot: resolve(root),
    harness,
    generation: env.VOUCH_GENERATION || "untracked",
    now,
    newId,
  };
}
