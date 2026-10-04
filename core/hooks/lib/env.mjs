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

/** A manual command's explicitly configured Intent, never inferred. @param {Record<string,string|undefined>} [env] */
export const readIntent = (env = process.env) => env.VOUCH_INTENT || null;

/** A manual command's arguments after the entry path. @param {string[]} [argv] */
export const readArgs = (argv = process.argv) => argv.slice(2);

/** Values of secret-named variables, longest first. @param {{names:string,minLength:number}} rule @param {Record<string,string|undefined>} [env] */
export const readSecrets = ({ names, minLength }, env = process.env) =>
  Object.keys(env)
    .filter((name) => new RegExp(names, "i").test(name))
    .flatMap((name) => env[name] ?? [])
    .filter((value) => value.length >= minLength)
    .sort((a, b) => b.length - a.length);

/** @param {string} entryUrl @returns {import('./runtime-contracts.mjs').DoctorEnvironment} */
export function readDoctorContext(entryUrl, env = process.env) {
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

/** @param {Record<string,string|undefined>} [env] @param {string[]} [argv] @param {string} [cwd] */
export function readLaunchEnvironment(
  env = process.env,
  argv = process.argv,
  cwd = process.cwd(),
) {
  return {
    args: readArgs(argv),
    cwd,
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

/** @param {{projectRoot:string,runtimeRoot:string,harness:import('./contracts.mjs').Harness,intent:string}} selected
 * @param {Record<string,string|undefined>} [env] @returns {Record<string,string|undefined>} */
export const childEnvironment = (selected, env = process.env) => ({
  ...env,
  VOUCH_PROJECT_ROOT: selected.projectRoot,
  VOUCH_RUNTIME_ROOT: selected.runtimeRoot,
  VOUCH_HARNESS: selected.harness,
  VOUCH_INTENT: selected.intent,
});

// Node's default ESM resolver rejects encoded POSIX backslashes. Resolve only
// those file URLs through its native-path resolver; keep ordinary imports intact.
export const literalPathLoader = [
  "require('node:module').registerHooks({resolve(s,c,next){",
  "if(s.startsWith('.')||s.startsWith('file:')){const u=require('node:url'),v=new URL(s,c.parentURL);",
  "if(v.protocol==='file:'&&/%5c/i.test(v.href)){try{return{url:u.pathToFileURL(require.resolve(u.fileURLToPath(v))).href,shortCircuit:true};}",
  "catch(e){if(e.code==='MODULE_NOT_FOUND'){e.code='ERR_MODULE_NOT_FOUND';e.url=v.href;}throw e;}}}",
  "return next(s,c);}});",
].join("");

/** Keep paths and user arguments as data, using fixed code only where Node needs it.
 * @param {string} entry @param {string[]} args @param {NodeJS.Platform} [platform] @param {boolean} [literal] */
export function nodeArguments(
  entry,
  args,
  platform = process.platform,
  literal = entry.includes("\\"),
) {
  return platform !== "win32" && literal
    ? [
        "-e",
        `${literalPathLoader}import(require('node:url').pathToFileURL(process.argv[1]).href)`,
        entry,
        ...args,
      ]
    : [entry, ...args];
}
