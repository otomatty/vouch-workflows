import { spawn, spawnSync } from "node:child_process";
import {
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

// Developer-only alternating measurements. The contract test remains the budget gate.
// --load keeps CPU-count - 1 background workers spawning no-op hooks, like a parallel suite.
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

/** @param {string} root @param {string} mode @param {number} i */
function execution(root, mode, i) {
  const review = mode === "review";
  const component = components[mode];
  const args =
    mode === "empty"
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
  for (let i = 0; ; i++) {
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
const modes = [
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
/** @type {{mode:string,ms:number}[]} */ const samples = [];
try {
  for (let i = 0; i < budgets.timing.samples; i++)
    for (const mode of modes) {
      const { args, env, input } = execution(root, mode, i);
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
      if (result.error || !expected || result.stdout)
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
        scope:
          "alternating complete process executions; no warm-up exclusion or startup subtraction",
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
          };
        }),
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  for (const worker of workers) worker.kill();
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
