import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { newId, now } from "./clock.mjs";

/**
 * Explicit VOUCH_PROJECT_ROOT wins, including invalid values. Only an absent root
 * on the configured Claude harness may use the exported CLAUDE_PROJECT_DIR.
 * @param {Record<string,string|undefined>} [env]
 * @returns {import('./contracts.mjs').HookContext}
 */
export function readContext(env = process.env) {
  const harness = env.VOUCH_HARNESS;
  const root =
    env.VOUCH_PROJECT_ROOT ??
    (harness === "claude" ? env.CLAUDE_PROJECT_DIR : undefined);
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

/** A manual command's explicitly configured Intent, never inferred. @param {Record<string,string|undefined>} [env] */
export const readIntent = (env = process.env) => env.VOUCH_INTENT || null;

/** Values of secret-named variables, longest first. @param {{names:string,minLength:number}} rule @param {Record<string,string|undefined>} [env] */
export const readSecrets = ({ names, minLength }, env = process.env) =>
  Object.keys(env)
    .filter((name) => new RegExp(names, "i").test(name))
    .flatMap((name) => env[name] ?? [])
    .filter((value) => value.length >= minLength)
    .sort((a, b) => b.length - a.length);

/** @param {string} entryUrl @returns {import('./runtime-contracts.mjs').DoctorEnvironment} */
export function readDoctorContext(entryUrl) {
  const directory = resolve(dirname(fileURLToPath(entryUrl)), "..");
  const projectRoot = resolve(directory, "..");
  return {
    projectRoot,
    installationRoot: relative(projectRoot, directory),
    nodeVersion: process.versions.node,
  };
}
