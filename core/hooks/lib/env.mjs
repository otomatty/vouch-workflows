import { isAbsolute, resolve } from "node:path";
import { newId, now } from "./clock.mjs";

/**
 * Explicit VOUCH_PROJECT_ROOT wins, including invalid values. Only an absent root
 * on the configured Claude harness may use the exported CLAUDE_PROJECT_DIR.
 * @param {Record<string,string|undefined>} [env]
 * @returns {import('./contracts.mjs').HookContext}
 */
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
    ...(env.VOUCH_INTENT ? { intent: env.VOUCH_INTENT } : {}),
    generation: env.VOUCH_GENERATION || "untracked",
    now,
    newId,
  };
}
