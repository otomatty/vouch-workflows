import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

/** Discover only the two copied project registrations in an isolated CODEX_HOME.
 * @param {string} executable @param {NodeJS.ProcessEnv} env
 * @param {string} project @param {string[]} commands
 * @returns {Promise<{hooks:import('../native-contracts.mjs').ListedHook[],config:string}>}
 */
export async function projectHookTrust(executable, env, project, commands) {
  const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
    cwd: project,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise((accept) => child.once("close", accept));
  let sequence = 0;
  /** @type {Map<number,{resolve:(value:unknown)=>void,reject:(error:Error)=>void}>} */
  const pending = new Map();
  /** @param {Error} error */
  const fail = (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    child.kill();
  };
  child.on("error", fail);
  child.on("close", () => fail(new Error("NATIVE-HOOKS: app-server closed")));
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error("NATIVE-HOOKS: RPC error"));
      else request.resolve(message.result);
    } catch {
      fail(new Error("NATIVE-HOOKS: malformed RPC response"));
    }
  });
  const timeout = setTimeout(
    () => fail(new Error("NATIVE-HOOKS: discovery timeout")),
    20000,
  );
  /** @param {string} method @param {object} params */
  const request = (method, params) =>
    new Promise((accept, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve: accept, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  try {
    await request("initialize", {
      clientInfo: { name: "vouch_native_review", version: "0.0.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const response = await request("hooks/list", { cwds: [project] });
    if (
      !response ||
      typeof response !== "object" ||
      !("data" in response) ||
      !Array.isArray(response.data)
    )
      throw new Error("NATIVE-HOOKS: missing discovery result");
    /** @type {import('../native-contracts.mjs').ListedHook[]} */
    const hooks = response.data.flatMap(
      (
        /** @type {{hooks?:import('../native-contracts.mjs').ListedHook[],errors?:unknown[],warnings?:unknown[]}} */ row,
      ) => {
        if (
          !Array.isArray(row.hooks) ||
          row.errors?.length ||
          row.warnings?.length
        )
          throw new Error("NATIVE-HOOKS: discovery diagnostics");
        return row.hooks;
      },
    );
    const source = resolve(project, ".codex/hooks.json");
    const config = projectHookConfig(hooks, source, commands);
    return { hooks, config };
  } finally {
    child.stdin.end();
    child.kill();
    await exited;
    clearTimeout(timeout);
    lines.close();
  }
}

/** Exact event-command mapping before writing trust into the isolated home.
 * @param {import('../native-contracts.mjs').ListedHook[]} hooks
 * @param {string} source @param {string[]} commands @returns {string}
 */
export function projectHookConfig(hooks, source, commands) {
  if (
    hooks.length !== 2 ||
    new Set(hooks.map((hook) => hook.eventName)).size !== 2 ||
    hooks.some(
      (hook) =>
        hook.source !== "project" ||
        hook.sourcePath !== source ||
        !hook.key.startsWith(`${source}:`) ||
        !/^sha256:[a-f0-9]{64}$/.test(hook.currentHash) ||
        !["sessionStart", "userPromptSubmit"].includes(hook.eventName) ||
        hook.command !== commands[hook.eventName === "sessionStart" ? 0 : 1],
    )
  )
    throw new Error("NATIVE-HOOKS: unexpected registration; no trust written");
  const config = hooks
    .map(
      (hook) =>
        `\n[hooks.state.${JSON.stringify(hook.key)}]\nenabled = true\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`,
    )
    .join("");
  return config;
}
