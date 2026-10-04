import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
import { planned } from "../tests/helpers/intent-review.mjs";
import {
  asked,
  auditPath,
  card,
  decisions,
  defaulted,
  home,
  jsonl,
  intent as resumeIntent,
} from "../tests/helpers/resume.mjs";
import { profileSummary } from "./lib/benchmark-profile.mjs";

// Developer-only alternating measurements. The contract test remains the budget gate.
// --load keeps CPU-count - 1 background workers spawning no-op hooks, like a parallel suite.
// --profile samples each main thread; times may include blocking I/O and idle time.
// --resume compares populated replay with empty/no-op processes, retaining each profile.
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
const resumed = captured(
  "claude/2.1.283/linux/print/SessionStart.resume.json",
  "SessionStart",
);
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
const resume = process.argv.includes("--resume");

/** @param {string} root @param {string} mode @param {number} i */
function execution(root, mode, i) {
  const review = mode === "review";
  const component = components[mode];
  const profiling = profile
    ? [
        "--cpu-prof",
        "--cpu-prof-interval=100",
        `--cpu-prof-dir=${join(root, "profiles", mode)}`,
        `--cpu-prof-name=sample-${i}.cpuprofile`,
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
    VOUCH_HARNESS: review || mode === "resume" ? "claude" : "codex",
    VOUCH_INTENT:
      mode === "noop" || mode === "load"
        ? ""
        : mode === "resume"
          ? resumeIntent
          : mode,
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
    : mode === "resume"
      ? { ...resumed.payload, cwd: root }
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
  process.exit(0);
}

const load = process.argv.includes("--load");
const root = mkdtempSync(join(tmpdir(), "vouch-benchmark-hook-"));
mkdirSync(join(root, "vouch/intents/review"), { recursive: true });
writeFileSync(join(root, "vouch/intents/review/intent.md"), draft);
if (resume) {
  const questions = Array.from({ length: 40 }, (_, i) => asked(`Q-${i + 1}`));
  mkdirSync(join(root, home, "audit"), { recursive: true });
  writeFileSync(join(root, home, "intent.md"), planned());
  writeFileSync(join(root, home, "decisions.md"), decisions(card()));
  writeFileSync(
    join(root, auditPath),
    jsonl([...questions, ...questions.slice(0, 20).map(defaulted)]),
  );
}
const modes = resume
  ? ["esm-empty", "noop", "resume"]
  : profile
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
/** @type {{mode:string,index:number,ms:number}[]} */ const samples = [];
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
      samples.push({ mode, index: i, ms: elapsed });
    }
  for (const mode of modes.filter((mode) =>
    ["record", "record-clock", "review"].includes(mode),
  )) {
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
  if (resume) {
    const rows = readFileSync(join(root, auditPath), "utf8")
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row));
    if (
      rows.length !== 61 ||
      rows.filter((row) => row.type === "session.resumed").length !== 1
    )
      throw new Error(
        "Benchmark resume did not preserve the initial audit and replay one session",
      );
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        cpus: availableParallelism(),
        loadWorkers: workers.length,
        synthetic: true,
        fixtureVersions: resume
          ? [resumed.version]
          : [startup.version, prompt.version],
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
            ...(profile
              ? {
                  profile: profileSummary(
                    join(root, "profiles", mode),
                    samples.filter((sample) => sample.mode === mode),
                  ),
                }
              : {}),
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
