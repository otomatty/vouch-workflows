import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { nativeEnvironment } from "./lib/native-environment.mjs";

// Developer-only shell startup diagnostic for the isolated native review environment.
// It compares environments and commands; the packaging tests remain the budget gate.
const windows = process.platform === "win32";
const home = mkdtempSync(join(tmpdir(), "vouch-benchmark-shell-"));
const isolated = nativeEnvironment(process.env, {
  home,
  project: home,
  intent: "benchmark-shell",
});
const environments: Record<string, NodeJS.ProcessEnv> = {
  inherited: process.env,
  isolated,
  ...(windows
    ? {
        "isolated+appdata": {
          ...isolated,
          ...Object.fromEntries(
            ["LOCALAPPDATA", "APPDATA", "PSMODULEPATH", "PROGRAMFILES"]
              .map((key) => [
                key,
                Object.entries(process.env).find(
                  ([name]) => name.toUpperCase() === key,
                )?.[1],
              ])
              .filter(([, value]) => value !== undefined),
          ),
        },
      }
    : {}),
};
// "missing" is the negative preflight: command lookup fails and may scan modules.
const commands = windows
  ? {
      exit: "exit 0",
      node: "& node --version; exit $LASTEXITCODE",
      "node.exe": "& node.exe --version; exit $LASTEXITCODE",
      missing: "& vouch-missing-command; exit $LASTEXITCODE",
      "missing-noautoload":
        "$PSModuleAutoLoadingPreference = 'None'; & vouch-missing-command; exit $LASTEXITCODE",
    }
  : {
      exit: "exit 0",
      node: "node --version",
      missing: "vouch-missing-command",
    };
const shell = windows
  ? resolve(
      process.env.SYSTEMROOT ?? "C:/Windows",
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    )
  : "/bin/sh";
const samples: {
  environment: string;
  command: string;
  ms: number;
  status: number | null;
}[] = [];
try {
  for (let i = 0; i < 5; i++)
    for (const [environment, env] of Object.entries(environments))
      for (const [command, text] of Object.entries(commands)) {
        const started = performance.now();
        const result = spawnSync(
          shell,
          windows
            ? ["-NoProfile", "-NonInteractive", "-Command", text]
            : ["-c", text],
          { env, encoding: "utf8", windowsHide: true, timeout: 10000 },
        );
        samples.push({
          environment,
          command,
          ms: performance.now() - started,
          status: result.error ? null : result.status,
        });
      }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        shell,
        budgetGate: false,
        results: Object.keys(environments).flatMap((environment) =>
          Object.keys(commands).map((command) => {
            const rows = samples.filter(
              (row) =>
                row.environment === environment && row.command === command,
            );
            const values = rows.map((row) => row.ms).sort((a, b) => a - b);
            return {
              environment,
              command,
              statuses: [...new Set(rows.map((row) => row.status))],
              min_ms: values[0],
              p50_ms: values[Math.ceil(values.length * 0.5) - 1],
              max_ms: values.at(-1),
            };
          }),
        ),
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  const within = relative(resolve(tmpdir()), resolve(home));
  if (
    within.startsWith("vouch-benchmark-shell-") &&
    !within.includes("..") &&
    !isAbsolute(within)
  )
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
}
