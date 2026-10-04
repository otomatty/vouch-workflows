import { spawnSync } from "node:child_process";
import { isAbsolute, resolve, win32 } from "node:path";
import { performance } from "node:perf_hooks";

/**
 * Keep OS lookup variables; replace task configuration and omit credentials.
 * @param {NodeJS.ProcessEnv} source
 * @param {import('../native-contracts.mjs').NativeScope} scope
 * @param {NodeJS.Platform} [platform]
 * @returns {NodeJS.ProcessEnv}
 */
export function nativeEnvironment(source, scope, platform = process.platform) {
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
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
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

/** Named node must run in the isolated shell, even when shell errors exit zero.
 * @param {NodeJS.ProcessEnv} env @returns {string} */
export function probeNode(env) {
  const windows = process.platform === "win32";
  const started = performance.now();
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
          "$PSModuleAutoLoadingPreference = 'None'; [Console]::Error.WriteLine('VOUCH-PROBE: shell-ready'); & node --version; $vouchProbeExit = $LASTEXITCODE; [Console]::Error.WriteLine('VOUCH-PROBE: node-finished'); exit $vouchProbeExit",
        ]
      : [
          "-c",
          "printf '%s\\n' 'VOUCH-PROBE: shell-ready' >&2; node --version; vouch_probe_exit=$?; printf '%s\\n' 'VOUCH-PROBE: node-finished' >&2; exit \"$vouch_probe_exit\"",
        ],
    { env, encoding: "utf8", windowsHide: true, timeout: 4000 },
  );
  const version = result.stdout?.trim() ?? "";
  if (
    result.error ||
    result.status !== 0 ||
    !/^v\d+\.\d+\.\d+$/.test(version)
  ) {
    const stage = !result.stderr?.includes("VOUCH-PROBE: shell-ready")
      ? "shell startup"
      : !result.stderr.includes("VOUCH-PROBE: node-finished")
        ? "node lookup or execution"
        : result.error
          ? "shell shutdown"
          : "node result validation";
    const startupError = /** @type {NodeJS.ErrnoException | undefined} */ (
      result.error
    );
    const code = startupError
      ? (startupError.code ?? "SPAWN")
      : `exit ${result.status}`;
    throw new Error(
      `NATIVE-NODE: named node could not run in the isolated shell; ${stage}; ${code}; ${(performance.now() - started).toFixed(1)} ms`,
      { cause: startupError },
    );
  }
  return version;
}
