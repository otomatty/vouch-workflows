import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import budgets from "../core/registry/budgets.json" with { type: "json" };
import operations from "../core/registry/operations.json" with { type: "json" };

// Developer-only alternating measurements. The contract test remains the budget gate.
// --load keeps CPU-count - 1 background workers spawning no-op hooks, like a parallel suite.
// --profile samples each hook's main thread and reports its CPU time by category.
/** @param {string} path @param {string} event */
function captured(path, event) {
  const fixture = JSON.parse(
    readFileSync(
      new URL(`../tests/fixtures/harness/${path}`, import.meta.url),
      "utf8",
    ),
  );
  if (
    fixture.synthetic ||
    fixture.provenance !== "captured" ||
    !fixture.version ||
    fixture.payload.hook_event_name !== event
  )
    throw new Error("TEST-7: versioned capture required");
  return fixture;
}
const startup = captured("codex/0.153.4/SessionStart.json", "SessionStart");
const prompt = captured("claude/UserPromptSubmit.json", "UserPromptSubmit");
const hook = (/** @type {string} */ name) =>
  fileURLToPath(new URL(`../core/hooks/${name}.mjs`, import.meta.url));
const preload = `--import=${new URL("../tests/helpers/fixed-clock.mjs", import.meta.url).href}`;
const draft =
  "---\nstatus: draft\n---\n# Synthetic review\n\nAC-1: preserve evidence.\n";

// Components loaded by a hook, each as an ESM eval compared with esm-empty.
/** @type {Record<string,string>} */
const components = {
  "fs-facade": 'await import("node:fs");',
  stdio: "process.stdin; process.stderr;",
  crypto:
    'process.getBuiltinModule("node:crypto").createHash("sha256").update("x").digest("hex");',
  schemas: `await import(${JSON.stringify(new URL("../core/hooks/lib/validation.mjs", import.meta.url).href)});`,
};

const profile = process.argv.includes("--profile");

/** @param {string} root @param {string} mode @param {number} i */
function execution(root, mode, i) {
  const review = mode === "review";
  const component = components[mode];
  const profiling = profile
    ? [
        "--cpu-prof",
        "--cpu-prof-interval=100",
        `--cpu-prof-dir=${join(root, "profiles", mode)}`,
      ]
    : [];
  const args = [
    ...profiling,
    ...(mode === "empty"
      ? ["-e", ""]
      : mode === "esm-empty"
        ? ["--input-type=module", "-e", ""]
        : mode === "preload-empty"
          ? [preload, "--input-type=module", "-e", ""]
          : component !== undefined
            ? ["--input-type=module", "-e", component]
            : [
                ...(mode === "record-clock" ? [preload] : []),
                hook(
                  review
                    ? "vouch-record-intent-review"
                    : "vouch-record-session-start",
                ),
              ]),
  ];
  /** @type {NodeJS.ProcessEnv} */ const env = {
    ...process.env,
    VOUCH_PROJECT_ROOT: root,
    VOUCH_HARNESS: review ? "claude" : "codex",
    VOUCH_INTENT: mode === "noop" || mode === "load" ? "" : mode,
    VOUCH_TEST_TIME: "2026-09-27T00:00:00.000Z",
  };
  delete env.NODE_V8_COVERAGE;
  const input = review
    ? {
        ...prompt.payload,
        cwd: root,
        prompt: "vouch review",
        prompt_id: `${mode}-${i}`,
      }
    : { ...startup.payload, cwd: root, session_id: `${mode}-${i}` };
  return { args, env, input: JSON.stringify(input) };
}

/** @param {string} root */
function owned(root) {
  const within = relative(resolve(tmpdir()), resolve(root));
  return (
    within.startsWith("vouch-benchmark-hook-") &&
    !within.includes("..") &&
    !isAbsolute(within)
  );
}

if (process.argv[2] === "--load-worker") {
  const root = process.argv[3] ?? "";
  if (!owned(root)) throw new Error("Unsafe benchmark load root");
  // Stop between executions, so no orphaned hook keeps the root busy on Windows.
  for (let i = 0; !existsSync(join(root, "stop")); i++) {
    const { args, env, input } = execution(root, "load", i);
    spawnSync(process.execPath, args, {
      cwd: root,
      env,
      input,
      windowsHide: true,
    });
  }
}

const load = process.argv.includes("--load");
const root = mkdtempSync(join(tmpdir(), "vouch-benchmark-hook-"));
mkdirSync(join(root, "vouch/intents/review"), { recursive: true });
writeFileSync(join(root, "vouch/intents/review/intent.md"), draft);
const modes = profile
  ? ["esm-empty", "noop", "record", "record-clock", "review"]
  : [
      "empty",
      "esm-empty",
      "preload-empty",
      ...Object.keys(components),
      "noop",
      "record",
      "record-clock",
      "review",
    ];

/** @param {{functionName:string,url:string}} frame */
function category(frame) {
  const { functionName: name, url } = frame;
  if (url.includes("/core/hooks/lib/validation.mjs")) return "hook validation";
  if (url.includes("/core/hooks/")) return "hook code";
  if (url.startsWith("node:internal/modules/")) return "module loader";
  if (url.startsWith("node:internal/bootstrap/")) return "builtin compile";
  if (url.startsWith("node:")) return "node other";
  if (!url) return name.startsWith("(") ? name : `native ${name}`;
  return "other";
}

/**
 * Main-thread CPU per execution by category; wall time minus this is process creation,
 * work before the profiler starts, other threads and exit.
 * @param {string} mode
 */
function profiled(mode) {
  const directory = join(root, "profiles", mode);
  const files = readdirSync(directory);
  /** @type {Record<string,number>} */ const totals = {};
  for (const file of files) {
    /** @type {{nodes:{id:number,callFrame:{functionName:string,url:string}}[],samples:number[],timeDeltas:number[]}} */
    const cpu = JSON.parse(readFileSync(join(directory, file), "utf8"));
    const frames = new Map(cpu.nodes.map((node) => [node.id, node.callFrame]));
    cpu.samples.forEach((id, index) => {
      const frame = frames.get(id);
      const key = frame ? category(frame) : "unknown";
      totals[key] =
        (totals[key] ?? 0) + (cpu.timeDeltas[index + 1] ?? 0) / 1000;
    });
  }
  const perRun = Object.entries(totals)
    .map(([name, ms]) => ({ name, ms: ms / files.length }))
    .sort((a, b) => b.ms - a.ms);
  return {
    executions: files.length,
    sampled_ms: perRun.reduce((sum, entry) => sum + entry.ms, 0),
    categories: perRun.filter((entry) => entry.ms >= 0.05),
  };
}
const workers = load
  ? Array.from({ length: Math.max(1, availableParallelism() - 1) }, () =>
      spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), "--load-worker", root],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      ),
    )
  : [];
/** @type {{mode:string,ms:number}[]} */ const samples = [];
try {
  for (let i = 0; i < budgets.timing.samples; i++)
    for (const mode of modes) {
      const { args, env, input } = execution(root, mode, i);
      // A startup with a configured Intent prints its resume summary (docs/development/resume.md).
      const summarizes =
        args.includes(hook("vouch-record-session-start")) &&
        Boolean(env.VOUCH_INTENT);
      const started = performance.now();
      const result = spawnSync(process.execPath, args, {
        cwd: root,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        input,
      });
      const elapsed = performance.now() - started;
      const expected =
        mode === "review"
          ? result.status === 2 && /VOUCH-REVIEW-RECORDED/.test(result.stderr)
          : result.status === 0 && !result.stderr;
      const output = summarizes
        ? result.stdout.startsWith(`${operations.labels.ja.summary}\n`)
        : !result.stdout;
      if (result.error || !expected || !output)
        throw new Error(
          `Benchmark failed: ${result.error?.message ?? result.stderr}`,
        );
      samples.push({ mode, ms: elapsed });
    }
  for (const mode of ["record", "record-clock", "review"]) {
    const rows = readFileSync(
      join(root, "vouch/intents", mode, "audit/events.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (
      rows.length !== budgets.timing.samples ||
      rows.some((row) =>
        mode === "review"
          ? row.type !== "gate.opened"
          : row.type !== "session.started",
      )
    )
      throw new Error("Benchmark did not record every expected event");
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        cpus: availableParallelism(),
        loadWorkers: workers.length,
        synthetic: true,
        fixtureVersions: [startup.version, prompt.version],
        budgetGate: false,
        scope: profile
          ? "profiled executions; wall times include profiler overhead"
          : "alternating complete process executions; no warm-up exclusion or startup subtraction",
        results: modes.map((mode) => {
          const values = samples
            .filter((sample) => sample.mode === mode)
            .map((sample) => sample.ms)
            .sort((a, b) => a - b);
          return {
            mode,
            samples: values.length,
            p50_ms: values[Math.ceil(values.length * 0.5) - 1],
            p95_ms: values[Math.ceil(values.length * 0.95) - 1],
            ...(profile ? { profile: profiled(mode) } : {}),
          };
        }),
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  writeFileSync(join(root, "stop"), "");
  await Promise.all(
    workers.map((worker) =>
      worker.exitCode === null && worker.signalCode === null
        ? new Promise((done) => worker.once("exit", done))
        : undefined,
    ),
  );
  if (!owned(root)) {
    console.error("Unsafe benchmark cleanup path");
    process.exitCode = 1;
  } else rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
