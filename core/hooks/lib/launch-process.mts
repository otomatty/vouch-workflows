import { spawnSync } from "node:child_process";
import { childEnvironment } from "./env.mjs";

export function executeProduct(
  entry: string,
  args: string[],
  input: string,
  selected: {
    projectRoot: string;
    runtimeRoot: string;
    harness: import("./contracts.mjs").Harness;
    intent: string;
  },
  execute: typeof spawnSync = spawnSync,
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
