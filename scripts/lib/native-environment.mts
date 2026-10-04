import { spawnSync } from "node:child_process";
import { isAbsolute, resolve, win32 } from "node:path";

/** Keep OS lookup variables; replace task configuration and omit credentials. */
export function nativeEnvironment(
  source: NodeJS.ProcessEnv,
  scope: import("../native-contracts.mjs").NativeScope,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const windows = platform === "win32";
  const absolute = windows ? win32.isAbsolute : isAbsolute;
  if (!absolute(scope.home) || !absolute(scope.project))
    throw new Error("NATIVE-ENV: absolute isolated paths required");
  const allowed = new Set(
    windows
      ? [
          "PATH",
          "PATHEXT",
          "SYSTEMROOT",
          "WINDIR",
          "TEMP",
          "TMP",
          "USERPROFILE",
          "COMSPEC",
        ]
      : ["PATH", "TMPDIR", "LANG", "LC_ALL", "TERM", "COLORTERM"],
  );
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    const normalized = windows ? key.toUpperCase() : key;
    if (allowed.has(normalized) && value !== undefined) env[normalized] = value;
  }
  if (
    !env.PATH?.trim() ||
    (windows && !env.PATHEXT?.toUpperCase().split(";").includes(".EXE"))
  )
    throw new Error("NATIVE-ENV: PATH and Windows PATHEXT with .EXE required");
  return {
    ...env,
    ...(!windows ? { HOME: scope.home } : {}),
    CODEX_HOME: scope.home,
    VOUCH_PROJECT_ROOT: scope.project,
    VOUCH_INTENT: scope.intent,
    VOUCH_HARNESS: "claude",
  };
}

/** Named node must run in the isolated shell, even when shell errors exit zero. */
export function probeNode(env: NodeJS.ProcessEnv): string {
  const windows = process.platform === "win32";
  const result = spawnSync(
    windows
      ? resolve(
          env.SYSTEMROOT ?? "C:/Windows",
          "System32/WindowsPowerShell/v1.0/powershell.exe",
        )
      : "/bin/sh",
    windows
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          // Resolving an application never needs modules; a miss must not scan them.
          "$PSModuleAutoLoadingPreference = 'None'; & node --version; exit $LASTEXITCODE",
        ]
      : ["-c", "node --version"],
    { env, encoding: "utf8", windowsHide: true, timeout: 4000 },
  );
  const version = result.stdout?.trim() ?? "";
  if (result.error || result.status !== 0 || !/^v\d+\.\d+\.\d+$/.test(version))
    throw new Error(
      "NATIVE-NODE: named node could not run in the isolated shell",
    );
  return version;
}
