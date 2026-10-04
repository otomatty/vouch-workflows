import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { newId, now } from "./clock.mjs";

/** Explicit VOUCH_PROJECT_ROOT wins, including invalid values. Only an absent root on the configured Claude harness may use the exported CLAUDE_PROJECT_DIR. */
export function readContext(
  env: Record<string, string | undefined> = process.env,
): import("./contracts.mjs").HookContext {
  const harness = env.VOUCH_HARNESS;
  const root =
    env.VOUCH_PROJECT_ROOT ??
    (harness === "claude" ? env.CLAUDE_PROJECT_DIR : undefined);
  if (
    !root ||
    !isAbsolute(root) ||
    (harness !== "claude" && harness !== "codex" && harness !== "cursor")
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

/** A manual command's explicitly configured Intent, never inferred. */
export const readIntent = (
  env: Record<string, string | undefined> = process.env,
) => env.VOUCH_INTENT || null;

/** A manual command's arguments after the entry path. */
export const readArgs = (argv: string[] = process.argv) => argv.slice(2);

/** Values of secret-named variables, longest first. */
export const readSecrets = (
  { names, minLength }: { names: string; minLength: number },
  env: Record<string, string | undefined> = process.env,
) =>
  Object.keys(env)
    .filter((name) => new RegExp(names, "i").test(name))
    .flatMap((name) => env[name] ?? [])
    .filter((value) => value.length >= minLength)
    .sort((a, b) => b.length - a.length);

export function readDoctorContext(
  entryUrl: string,
  env = process.env,
): import("./runtime-contracts.mjs").DoctorEnvironment {
  const directory = resolve(dirname(fileURLToPath(entryUrl)), "..");
  if (env.VOUCH_RUNTIME_ROOT === directory) {
    const context = readContext(env);
    return {
      projectRoot: context.projectRoot,
      installationRoot: "",
      runtimeRoot: directory,
      harness: context.harness,
      nodeVersion: process.versions.node,
    };
  }
  const projectRoot = resolve(directory, "..");
  return {
    projectRoot,
    installationRoot: relative(projectRoot, directory),
    nodeVersion: process.versions.node,
  };
}

export function readLaunchEnvironment(
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv,
  cwd: string = process.cwd(),
) {
  return {
    args: readArgs(argv),
    projectRoot:
      env.VOUCH_PROJECT_ROOT ??
      env.CLAUDE_PROJECT_DIR ??
      env.CURSOR_PROJECT_DIR ??
      cwd,
    explicit:
      env.VOUCH_PROJECT_ROOT !== undefined ||
      env.CLAUDE_PROJECT_DIR !== undefined ||
      env.CURSOR_PROJECT_DIR !== undefined,
    ...(env.VOUCH_INTENT === undefined ? {} : { intent: env.VOUCH_INTENT }),
  };
}

export const childEnvironment = (
  selected: {
    projectRoot: string;
    runtimeRoot: string;
    harness: import("./contracts.mjs").Harness;
    intent: string;
  },
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> => ({
  ...env,
  VOUCH_PROJECT_ROOT: selected.projectRoot,
  VOUCH_RUNTIME_ROOT: selected.runtimeRoot,
  VOUCH_HARNESS: selected.harness,
  VOUCH_INTENT: selected.intent,
});
