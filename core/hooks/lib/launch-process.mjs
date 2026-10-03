import { spawnSync } from "node:child_process";
import { childEnvironment } from "./env.mjs";

/** @param {string} entry @param {string[]} args @param {string} input
 * @param {{projectRoot:string,runtimeRoot:string,harness:import('./contracts.mjs').Harness,intent:string}} selected
 * @param {typeof spawnSync} [execute] */
export function executeProduct(
  entry,
  args,
  input,
  selected,
  execute = spawnSync,
) {
  const result = execute(process.execPath, [entry, ...args], {
    cwd: selected.projectRoot,
    input,
    encoding: "utf8",
    windowsHide: true,
    env: childEnvironment(selected),
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}
