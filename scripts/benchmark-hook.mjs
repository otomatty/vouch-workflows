import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import budgets from "../core/registry/budgets.json" with { type: "json" };

// Developer-only alternating measurements. The contract test remains the budget gate.
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../tests/fixtures/harness/codex/0.153.4/SessionStart.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
if (
  fixture.synthetic ||
  fixture.provenance !== "captured" ||
  !fixture.version ||
  fixture.payload.hook_event_name !== "SessionStart"
)
  throw new Error("TEST-7: versioned startup capture required");
const root = mkdtempSync(join(tmpdir(), "vouch-benchmark-hook-"));
const hook = new URL(
  "../core/hooks/vouch-record-session-start.mjs",
  import.meta.url,
);
const preload = `--import=${new URL("../tests/helpers/fixed-clock.mjs", import.meta.url).href}`;
const modes = [
  "empty",
  "esm-empty",
  "preload-empty",
  "noop",
  "record",
  "record-clock",
];
/** @type {{mode:string,ms:number}[]} */ const samples = [];
try {
  for (let i = 0; i < budgets.timing.samples; i++)
    for (const mode of modes) {
      const args =
        mode === "empty"
          ? ["-e", ""]
          : mode === "esm-empty"
            ? ["--input-type=module", "-e", ""]
            : mode === "preload-empty"
              ? [preload, "--input-type=module", "-e", ""]
              : [
                  ...(mode === "record-clock" ? [preload] : []),
                  fileURLToPath(hook),
                ];
      /** @type {NodeJS.ProcessEnv} */ const env = {
        ...process.env,
        VOUCH_PROJECT_ROOT: root,
        VOUCH_HARNESS: "codex",
        VOUCH_INTENT: mode === "noop" ? "" : mode,
        VOUCH_TEST_TIME: "2026-09-27T00:00:00.000Z",
      };
      delete env.NODE_V8_COVERAGE;
      const started = performance.now();
      const result = spawnSync(process.execPath, args, {
        cwd: root,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        input: JSON.stringify({
          ...fixture.payload,
          cwd: root,
          session_id: `${mode}-${i}`,
        }),
      });
      const elapsed = performance.now() - started;
      if (result.error || result.status !== 0 || result.stdout || result.stderr)
        throw new Error(
          `Benchmark failed: ${result.error?.message ?? result.stderr}`,
        );
      samples.push({ mode, ms: elapsed });
    }
  for (const mode of ["record", "record-clock"]) {
    const rows = readFileSync(
      join(root, "vouch/intents", mode, "audit/events.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (
      rows.length !== budgets.timing.samples ||
      rows.some(
        (row, i) =>
          row.session !== `${mode}-${i}` ||
          row.type !== "session.started" ||
          row.harness !== "codex",
      )
    )
      throw new Error("Benchmark did not record every expected event");
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        synthetic: true,
        fixtureVersion: fixture.version,
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
  const owned = relative(resolve(tmpdir()), resolve(root));
  if (
    !owned.startsWith("vouch-benchmark-hook-") ||
    owned.includes("..") ||
    isAbsolute(owned)
  ) {
    console.error("Unsafe benchmark cleanup path");
    process.exitCode = 1;
  } else rmSync(root, { recursive: true, force: true });
}
