import { execFileSync } from "node:child_process";
import budgets from "../../core/registry/budgets.json" with { type: "json" };
import { cpuLoad } from "../helpers/cpu-load.mjs";
import { deriveFixture } from "../helpers/fixtures.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { knowledgeFiles } from "../helpers/knowledge.mjs";
import { capturedPrompt, runHook, sandbox } from "../helpers/runtime.mjs";

test("knowledge freshness with Git and file reads stays below the check p95 budget under CPU load", async (t) => {
  const box = await sandbox(t);
  execFileSync("git", [
    "-C",
    box.root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-qm",
    "initial",
  ]);
  const generation = execFileSync(
    "git",
    ["-C", box.root, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const files = knowledgeFiles();
  const index = JSON.parse(files["vouch/knowledge/index.json"]);
  index.generation = generation;
  files["vouch/knowledge/index.json"] = JSON.stringify(index);
  for (const [path, text] of Object.entries(files)) await box.write(path, text);
  /** @type {number[]} */ const times = [];
  const capture = capturedPrompt();
  const load = await cpuLoad(t);
  try {
    for (let i = 0; i < budgets.timing.samples; i++) {
      const fixture = deriveFixture(capture, {
        cwd: box.root,
        prompt: "vouch knowledge check",
        prompt_id: `knowledge-perf-${i}`,
      });
      const result = runHook("vouch-record-intent-review", fixture, {
        root: box.root,
        intent: "knowledge-perf",
        coverage: false,
      });
      t.assert.equal(result.exitCode, 2);
      t.assert.match(result.stderr, /VOUCH-KNOWLEDGE: passed/);
      times.push(result.durationMs);
    }
  } finally {
    await load.stop();
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  t.diagnostic(
    `knowledge check p95 ${p95?.toFixed(1)} ms (${times.length} processes, ${load.workers} load workers)`,
  );
  t.assert.equal(
    typeof p95 === "number" && p95 < budgets.timing.checkP95Ms,
    true,
    `HOOK-13: ${p95} < ${budgets.timing.checkP95Ms}`,
  );
});
