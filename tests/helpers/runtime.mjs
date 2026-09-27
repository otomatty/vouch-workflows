import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { isContractFixture, readJson } from "./registry.mjs";

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
 * Transport driver only; no product emitter coverage is claimed.
 * @param {string} mode
 * @param {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} fixture
 * @param {{root:string,raw?:string}} options
 */
export function runHook(mode, fixture, options) {
  const reference = capturedPrompt();
  if (
    !isContractFixture(reference) ||
    reference.harness !== fixture.harness ||
    reference.payload.hook_event_name !== fixture.payload.hook_event_name
  )
    throw new Error("TEST-7: no versioned capture for this harness event");
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [resolve("tests/fixtures/runtime/driver.mjs"), mode],
    {
      cwd: options.root,
      input: options.raw ?? JSON.stringify(fixture.payload),
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
      env: {
        ...process.env,
        VOUCH_PROJECT_ROOT: options.root,
        VOUCH_HARNESS: fixture.harness,
        VOUCH_GENERATION: "test",
      },
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
