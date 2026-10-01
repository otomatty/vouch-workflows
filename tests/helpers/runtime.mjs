import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { contractReference, deriveFixture } from "./fixtures.mjs";
import { defaultTestInstant, executeHook } from "./hook-process.mjs";
import { readJson, validator } from "./registry.mjs";

// Filesystem-only tests do not compile schemas. Preparation precedes hook timing.
/** @type {ReturnType<typeof validator>|undefined} */
let validateFixture;

/** Validate captured provenance and derived payload once before starting a process.
 * @param {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} fixture */
export function checkFixture(fixture) {
  // Throws TEST-7 unless an inventoried capture of this kind and version exists.
  contractReference(fixture);
  validateFixture ??= validator("harness-fixture");
  if (!validateFixture(fixture))
    throw new Error(
      "TEST-7: changed payload must be marked synthetic with matching capture version",
    );
}

/** @param {string} [instant] @returns {import('../../core/hooks/lib/runtime-contracts.mjs').Clock} */
export function fakeClock(instant = defaultTestInstant) {
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
    readBytes: async (path) => {
      const text = data.get(path);
      return text === undefined ? null : Buffer.from(text, "utf8");
    },
    createBytes: async (path, bytes) => {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const before = data.get(path);
      if (before === text) return false;
      if (before !== undefined)
        throw new Error("FS-CONFLICT: different existing content");
      data.set(path, text);
      return true;
    },
    list: async (path) => {
      const prefix = `${path}/`;
      const names = new Map();
      for (const key of data.keys())
        if (key.startsWith(prefix)) {
          const [name = "", ...rest] = key.slice(prefix.length).split("/");
          names.set(name, rest.length ? "directory" : "file");
        }
      return names.size
        ? [...names].sort().map(([name, kind]) => ({ name, kind }))
        : null;
    },
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
  checkFixture(fixture);
  return executeHook(mode, fixture.payload, fixture.harness, options);
}
