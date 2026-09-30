import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export const defaultTestInstant = "2026-09-27T00:00:00.000Z";

/** Process boundary shared by validated fixture tests and prepared load workers.
 * @param {string} mode
 * @param {import('../../core/hooks/lib/contracts.mjs').HarnessFixture['payload']} payload
 * @param {'claude'|'codex'} harness
 * @param {{root:string,raw?:string,intent?:string,instant?:string,coverage?:boolean,configuredHarness?:'claude'|'codex',moduleLog?:string}} options
 */
export function executeHook(mode, payload, harness, options) {
  const started = performance.now();
  const product = /^vouch-[a-z-]+$/.test(mode);
  /** @type {NodeJS.ProcessEnv} */ const env = {
    ...process.env,
    VOUCH_PROJECT_ROOT: options.root,
    VOUCH_HARNESS: options.configuredHarness ?? harness,
    VOUCH_GENERATION: "test",
    VOUCH_INTENT: options.intent ?? "",
    VOUCH_TEST_TIME: options.instant ?? defaultTestInstant,
  };
  if (options.coverage === false) delete env.NODE_V8_COVERAGE;
  if (options.moduleLog) env.VOUCH_TEST_MODULE_LOG = options.moduleLog;
  const result = spawnSync(
    process.execPath,
    product
      ? [
          "--disable-warning=ExperimentalWarning",
          `--import=${pathToFileURL(resolve("tests/helpers/fixed-clock.mjs")).href}`,
          ...(options.moduleLog
            ? [
                `--import=${pathToFileURL(resolve("tests/helpers/module-probe.mjs")).href}`,
              ]
            : []),
          resolve(`core/hooks/${mode}.mjs`),
        ]
      : [resolve("tests/fixtures/runtime/driver.mjs"), mode],
    {
      cwd: options.root,
      input: options.raw ?? JSON.stringify(payload),
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
      env,
    },
  );
  if (result.error) throw result.error;
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: performance.now() - started,
  };
}
