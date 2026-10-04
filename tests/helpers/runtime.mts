import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { contractReference, deriveFixture } from "./fixtures.mjs";
import { defaultTestInstant, executeHook } from "./hook-process.mjs";
import { readJson, validator } from "./registry.mjs";

// Filesystem-only tests do not compile schemas. Preparation precedes hook timing.
let validateFixture: ReturnType<typeof validator> | undefined;

/** Validate captured provenance and derived payload once before starting a process. */
export function checkFixture(
  fixture: import("../../core/hooks/lib/contracts.mjs").HarnessFixture,
) {
  // Throws TEST-7 unless an inventoried capture of this kind and version exists.
  contractReference(fixture);
  validateFixture ??= validator("harness-fixture");
  if (!validateFixture(fixture))
    throw new Error(
      "TEST-7: changed payload must be marked synthetic with matching capture version",
    );
}

export function fakeClock(
  instant: string = defaultTestInstant,
): import("../../core/hooks/lib/runtime-contracts.mjs").Clock {
  return {
    now: () => instant,
    newId: (session, identity) => `test-${JSON.stringify([session, identity])}`,
  };
}

export async function sandbox(
  t: import("node:test").TestContext,
  options: { git?: boolean } = {},
) {
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
    path: (path: string) => resolve(root, path),
    read: (path: string) => readFile(join(root, path), "utf8"),
    write: async (path: string, text: string) => {
      const file = resolve(root, path);
      if (relative(root, file).startsWith("..")) throw new Error("TEST-4");
      await mkdir(resolve(file, ".."), { recursive: true });
      await writeFile(file, text);
    },
  };
}

export function memoryFiles(
  initial: Record<string, string> = {},
): import("../../core/hooks/lib/runtime-contracts.mjs").FileStore & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  const updateText = async (
    path: string,
    update: import("../../core/hooks/lib/runtime-contracts.mjs").TextUpdate,
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

export function capturedPrompt(
  harness: "claude" | "codex" = "claude",
): import("../../core/hooks/lib/contracts.mjs").HarnessFixture {
  return readJson(
    harness === "codex"
      ? "tests/fixtures/harness/codex/0.153.4/UserPromptSubmit.json"
      : "tests/fixtures/harness/claude/UserPromptSubmit.json",
  );
}

function capturedSession(
  harness: "claude" | "codex" = "claude",
): import("../../core/hooks/lib/contracts.mjs").HarnessFixture {
  return readJson(
    harness === "codex"
      ? "tests/fixtures/harness/codex/0.153.4/SessionStart.json"
      : "tests/fixtures/harness/claude/SessionStart.json",
  );
}

export function sessionFor(
  root: string,
  harness: "claude" | "codex" = "claude",
): import("../../core/hooks/lib/contracts.mjs").HarnessFixture {
  return deriveFixture(capturedSession(harness), { cwd: root });
}

export function promptFor(
  root: string,
): import("../../core/hooks/lib/contracts.mjs").HarnessFixture {
  return deriveFixture(capturedPrompt(), { cwd: root });
}

/** Product entries and the separate transport driver share the same observation boundary. */
export function runHook(
  mode: string,
  fixture: import("../../core/hooks/lib/contracts.mjs").HarnessFixture,
  options: {
    root: string;
    raw?: string;
    intent?: string;
    instant?: string;
    coverage?: boolean;
    configuredHarness?: "claude" | "codex";
    moduleLog?: string;
  },
) {
  checkFixture(fixture);
  return executeHook(mode, fixture.payload, fixture.harness, options);
}
