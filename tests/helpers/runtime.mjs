import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { isContractFixture, readJson, validator } from "./registry.mjs";

// Compile immutable test schemas once per test process, outside measured hook executions.
const validateFixture = validator("harness-fixture");

/** @param {string} [instant] @returns {import('../../core/hooks/lib/runtime-contracts.mjs').Clock} */
export function fakeClock(instant = "2026-09-27T00:00:00.000Z") {
  return {
    now: () => instant,
    newId: (session, identity) => `test-${JSON.stringify([session, identity])}`,
  };
}

/** @param {import('node:test').TestContext} t @param {{git?:boolean}} [options] */
export async function sandbox(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "vouch-runtime-"));
  const within = relative(tmpdir(), root);
  if (
    !within.startsWith("vouch-runtime-") ||
    within.includes("..") ||
    isAbsolute(within)
  )
    throw new Error("TEST-4: unsafe cleanup root");
  t.after(() => rm(root, { recursive: true, force: true }));
  if (options.git !== false)
    execFileSync("git", ["init", "--quiet", "--initial-branch=main", root], {
      windowsHide: true,
    });
  return {
    root,
    path: (/** @type {string} */ path) => resolve(root, path),
    read: (/** @type {string} */ path) => readFile(join(root, path), "utf8"),
    write: async (/** @type {string} */ path, /** @type {string} */ text) => {
      const file = resolve(root, path);
      if (relative(root, file).startsWith("..")) throw new Error("TEST-4");
      await mkdir(resolve(file, ".."), { recursive: true });
      await writeFile(file, text);
    },
  };
}

/** @param {Record<string,string>} [initial] @returns {import('../../core/hooks/lib/runtime-contracts.mjs').FileStore & {data:Map<string,string>}} */
export function memoryFiles(initial = {}) {
  const data = new Map(Object.entries(initial));
  const updateText = async (
    /** @type {string} */ path,
    /** @type {import('../../core/hooks/lib/runtime-contracts.mjs').TextUpdate} */ update,
  ) => {
    const before = data.get(path) ?? null;
    const next = update(before);
    if (next === null || next === before) return false;
    data.set(path, next);
    return true;
  };
  return {
    data,
    resolvePath: async (path) => path,
    readText: async (path) => data.get(path) ?? null,
    updateText,
    writeText: async (path, text) => updateText(path, () => text),
  };
}

/** @returns {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} */
export function capturedPrompt() {
  return readJson("tests/fixtures/harness/claude/UserPromptSubmit.json");
}

/** @returns {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} */
function capturedSession() {
  return readJson("tests/fixtures/harness/claude/SessionStart.json");
}

/** @param {string} root @returns {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} */
export function sessionFor(root) {
  const capture = capturedSession();
  return {
    ...capture,
    synthetic: true,
    provenance: "synthetic",
    payload: { ...capture.payload, cwd: root },
  };
}

/** @param {string} root @returns {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} */
export function promptFor(root) {
  const capture = capturedPrompt();
  return {
    ...capture,
    synthetic: true,
    provenance: "synthetic",
    payload: { ...capture.payload, cwd: root },
  };
}

/**
 * Product entries and the separate transport driver share the same observation boundary.
 * @param {string} mode
 * @param {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} fixture
 * @param {{root:string,raw?:string,intent?:string,instant?:string,coverage?:boolean,configuredHarness?:'claude'|'codex'}} options
 */
export function runHook(mode, fixture, options) {
  const reference =
    fixture.payload.hook_event_name === "SessionStart"
      ? capturedSession()
      : capturedPrompt();
  if (
    !isContractFixture(reference) ||
    reference.harness !== fixture.harness ||
    reference.payload.hook_event_name !== fixture.payload.hook_event_name
  )
    throw new Error("TEST-7: no versioned capture for this harness event");
  if (
    !validateFixture(fixture) ||
    fixture.version !== reference.version ||
    (!fixture.synthetic && !isDeepStrictEqual(fixture, reference))
  )
    throw new Error(
      "TEST-7: changed payload must be marked synthetic with matching capture version",
    );
  const started = performance.now();
  const product = mode === "vouch-record-session-start";
  /** @type {NodeJS.ProcessEnv} */ const env = {
    ...process.env,
    VOUCH_PROJECT_ROOT: options.root,
    VOUCH_HARNESS: options.configuredHarness ?? fixture.harness,
    VOUCH_GENERATION: "test",
    VOUCH_INTENT: options.intent ?? "",
    VOUCH_TEST_TIME: options.instant ?? fakeClock().now(),
  };
  if (options.coverage === false) delete env.NODE_V8_COVERAGE;
  const result = spawnSync(
    process.execPath,
    product
      ? [
          "--disable-warning=ExperimentalWarning",
          `--import=${pathToFileURL(resolve("tests/helpers/fixed-clock.mjs")).href}`,
          resolve("core/hooks/vouch-record-session-start.mjs"),
        ]
      : [resolve("tests/fixtures/runtime/driver.mjs"), mode],
    {
      cwd: options.root,
      input: options.raw ?? JSON.stringify(fixture.payload),
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
