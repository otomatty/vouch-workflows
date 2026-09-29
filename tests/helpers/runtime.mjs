import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { contractReference, deriveFixture } from "./fixtures.mjs";
import { readJson, validator } from "./registry.mjs";

// Filesystem-only tests do not compile schemas. Preparation precedes hook timing.
/** @type {ReturnType<typeof validator>|undefined} */
let validateFixture;

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
    // Keys are root-relative; the memory store has no links, aliases or outside paths.
    locate: async (path) => {
      const inside = path.replaceAll("\\", "/").replace(/^\.\/?/, "");
      const directory = [...data.keys()].some((key) =>
        key.startsWith(`${inside}/`),
      );
      return {
        inside,
        contains: inside === "",
        kind: data.has(inside) ? "file" : directory ? "directory" : "missing",
        links: data.has(inside) ? 1 : 0,
      };
    },
  };
}

/** @param {'claude'|'codex'} [harness] @returns {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} */
export function capturedPrompt(harness = "claude") {
  return readJson(
    harness === "codex"
      ? "tests/fixtures/harness/codex/0.153.4/UserPromptSubmit.json"
      : "tests/fixtures/harness/claude/UserPromptSubmit.json",
  );
}

/** @param {'claude'|'codex'} [harness] @returns {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} */
function capturedSession(harness = "claude") {
  return readJson(
    harness === "codex"
      ? "tests/fixtures/harness/codex/0.153.4/SessionStart.json"
      : "tests/fixtures/harness/claude/SessionStart.json",
  );
}

/** @param {string} root @param {'claude'|'codex'} [harness] @returns {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} */
export function sessionFor(root, harness = "claude") {
  return deriveFixture(capturedSession(harness), { cwd: root });
}

/** @param {string} root @returns {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} */
export function promptFor(root) {
  return deriveFixture(capturedPrompt(), { cwd: root });
}

/**
 * Product entries and the separate transport driver share the same observation boundary.
 * @param {string} mode
 * @param {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} fixture
 * @param {{root:string,raw?:string,intent?:string,instant?:string,coverage?:boolean,configuredHarness?:'claude'|'codex',moduleLog?:string}} options
 */
export function runHook(mode, fixture, options) {
  // Throws TEST-7 unless an inventoried capture of this kind and version exists.
  contractReference(fixture);
  validateFixture ??= validator("harness-fixture");
  if (!validateFixture(fixture))
    throw new Error(
      "TEST-7: changed payload must be marked synthetic with matching capture version",
    );
  const started = performance.now();
  const product = /^vouch-[a-z-]+$/.test(mode);
  /** @type {NodeJS.ProcessEnv} */ const env = {
    ...process.env,
    VOUCH_PROJECT_ROOT: options.root,
    VOUCH_HARNESS: options.configuredHarness ?? fixture.harness,
    VOUCH_GENERATION: "test",
    VOUCH_INTENT: options.intent ?? "",
    VOUCH_TEST_TIME: options.instant ?? fakeClock().now(),
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
