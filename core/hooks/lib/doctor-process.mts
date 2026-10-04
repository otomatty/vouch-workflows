import { spawnSync } from "node:child_process";
import runtime from "../../registry/runtime.json" with { type: "json" };

/** Read-only Git availability probe; no shell, repository changes or network. */
export function gitStatus(
  execute: (
    command: string,
    args: string[],
    options: { encoding: "utf8"; windowsHide: boolean; timeout: number },
  ) => { status: number | null; stdout?: string; error?: Error } = spawnSync,
): import("./runtime-contracts.mjs").GitStatus {
  const result = execute("git", ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: runtime.gitTimeoutMs,
  });
  const text = result.stdout?.trim();
  return {
    ok: result.status === 0 && Boolean(text),
    detail: text || result.error?.message || "Git unavailable",
  };
}
