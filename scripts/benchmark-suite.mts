import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  fdatasyncSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import budgets from "../core/registry/budgets.json" with { type: "json" };
import { testTimeoutFor } from "./lib/time-budgets.mjs";

// Developer-only: the work that runs beside the HOOK-13 tests in the parallel hooks suite.
// Alternating commands, then each hooks file alone with the suite's flags. Never a budget gate.
// The flush kinds time a FileStore-sized durable replacement in the test temp directory and,
// on GitHub runners, in RUNNER_TEMP, with fsync and with fdatasync.
const root = mkdtempSync(join(tmpdir(), "vouch-benchmark-suite-"));
const runnerTemp = process.env.RUNNER_TEMP;
const runnerRoot = runnerTemp
  ? mkdtempSync(join(runnerTemp, "vouch-benchmark-suite-"))
  : undefined;
const log =
  `${JSON.stringify({ type: "gate.opened", note: "x".repeat(900) })}\n`.repeat(
    20,
  );

function replace(
  directory: string,
  name: string,
  flush: (descriptor: number) => void,
) {
  const temporary = join(directory, `${name}.next`);
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, log, "utf8");
    flush(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, join(directory, name));
}
const repository = resolve(".");
const prompt = JSON.parse(
  readFileSync("tests/fixtures/harness/claude/UserPromptSubmit.json", "utf8"),
).payload;
mkdirSync(join(root, "hook/vouch/intents/review"), { recursive: true });
writeFileSync(
  join(root, "hook/vouch/intents/review/intent.md"),
  "---\nstatus: draft\n---\n# Synthetic review\n\nAC-1: preserve evidence.\n",
);

function command(kind: string, i: number): () => void {
  const target = join(root, `${kind}-${i}`);
  switch (kind) {
    case "git-init":
      return () =>
        execFileSync(
          "git",
          ["init", "--quiet", "--initial-branch=main", target],
          {
            windowsHide: true,
          },
        );
    case "git-init-no-template":
      return () =>
        execFileSync(
          "git",
          ["init", "--quiet", "--initial-branch=main", "--template=", target],
          { windowsHide: true },
        );
    case "fsync-tmp":
      return () => replace(root, kind, fsyncSync);
    case "fdatasync-tmp":
      return () => replace(root, kind, fdatasyncSync);
    case "fsync-runner-temp":
      return () => replace(runnerRoot as string, kind, fsyncSync);
    case "fdatasync-runner-temp":
      return () => replace(runnerRoot as string, kind, fdatasyncSync);
    case "package":
      return () =>
        execFileSync(
          process.execPath,
          ["scripts/package.mjs", "--out", target],
          {
            cwd: repository,
            windowsHide: true,
          },
        );
    default: {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        VOUCH_PROJECT_ROOT: join(root, "hook"),
        VOUCH_HARNESS: "claude",
        VOUCH_INTENT: "review",
      };
      if (kind === "hook-coverage")
        env.NODE_V8_COVERAGE = join(root, "coverage");
      else delete env.NODE_V8_COVERAGE;
      const input = JSON.stringify({
        ...prompt,
        cwd: join(root, "hook"),
        prompt: "vouch review",
        prompt_id: `${kind}-${i}`,
      });
      return () => {
        const result = spawnSync(
          process.execPath,
          [join(repository, "core/hooks/vouch-record-intent-review.mjs")],
          { cwd: join(root, "hook"), env, input, windowsHide: true },
        );
        if (result.status !== 2) throw new Error(String(result.stderr));
      };
    }
  }
}

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50_ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

const kinds = [
  "git-init",
  "git-init-no-template",
  "package",
  "hook",
  "hook-coverage",
  "fsync-tmp",
  "fdatasync-tmp",
  ...(runnerRoot ? ["fsync-runner-temp", "fdatasync-runner-temp"] : []),
];
const times: Record<string, number[]> = Object.fromEntries(
  kinds.map((kind) => [kind, []]),
);
try {
  for (let i = 0; i < budgets.timing.samples; i++)
    for (const kind of kinds) {
      const run = command(kind, i);
      const started = performance.now();
      run();
      times[kind]?.push(performance.now() - started);
    }
  const files = readdirSync("tests/hooks")
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  const alone: { file: string; ms: number; status: number | null }[] = [];
  for (const file of files) {
    const started = performance.now();
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        `--test-timeout=${testTimeoutFor("hooks", budgets.timing)}`,
        "--import=./tests/helpers/no-network.mjs",
        "--experimental-test-coverage",
        "--test-coverage-include=core/hooks/*.mjs",
        `tests/hooks/${file}`,
      ],
      { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    alone.push({
      file,
      ms: performance.now() - started,
      status: result.status,
    });
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        cpus: availableParallelism(),
        temp: { test: tmpdir(), runner: runnerTemp ?? null },
        budgetGate: false,
        scope:
          "alternating complete commands, then each hooks file alone with coverage",
        results: kinds.map((kind) => ({ kind, ...summary(times[kind] ?? []) })),
        files: alone,
        samples: times,
      },
      null,
      2,
    ),
  );
} finally {
  for (const [base, path] of [
    [tmpdir(), root],
    [runnerTemp, runnerRoot],
  ]) {
    if (!base || !path) continue;
    const within = relative(resolve(base), resolve(path));
    if (
      !within.startsWith("vouch-benchmark-suite-") ||
      within.includes("..") ||
      isAbsolute(within)
    ) {
      console.error("Unsafe benchmark cleanup path");
      process.exitCode = 1;
    } else rmSync(path, { recursive: true, force: true, maxRetries: 5 });
  }
}
