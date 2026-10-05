import { execFileSync } from "node:child_process";
import { test } from "node:test";
import budgets from "../../core/registry/budgets.json" with { type: "json" };
import { cpuLoad } from "../helpers/cpu-load.mjs";
import { deriveFixture } from "../helpers/fixtures.mjs";
import { hookTest } from "../helpers/hook-test.mjs";
import { knowledgeFiles } from "../helpers/knowledge.mjs";
import { capturedPrompt, runHook, sandbox } from "../helpers/runtime.mjs";

// The parent organizes continuous samples; preparation and every leaf keep TEST-12's limit.
test("knowledge freshness with Git and file reads stays below the check p95 budget under CPU load", async (t) => {
  let box: Awaited<ReturnType<typeof sandbox>> | undefined;
  let load: Awaited<ReturnType<typeof cpuLoad>> | undefined;
  const times: number[] = [];
  const capture = capturedPrompt();
  t.after(async () => {
    await load?.stop();
  });
  await hookTest(
    "prepare the committed generation and start continuous CPU load",
    async () => {
      box = await sandbox(t);
      execFileSync("git", [
        "-C",
        box.root,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
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
      for (const [path, text] of Object.entries(files))
        await box.write(path, text);
      load = await cpuLoad(t);
    },
    t,
  );
  if (!box || !load)
    throw new Error("TEST-12: knowledge benchmark preparation failed");
  const root = box.root;
  try {
    for (let from = 0; from < budgets.timing.samples; from += 5) {
      const end = Math.min(from + 5, budgets.timing.samples);
      await hookTest(
        `measure knowledge processes ${from + 1}-${end}`,
        () => {
          for (let i = from; i < end; i++) {
            const fixture = deriveFixture(capture, {
              cwd: root,
              prompt: "vouch knowledge check",
              prompt_id: `knowledge-perf-${i}`,
            });
            const result = runHook("vouch-record-intent-review", fixture, {
              root,
              intent: "knowledge-perf",
              coverage: false,
            });
            t.assert.equal(result.exitCode, 2);
            t.assert.match(result.stderr, /VOUCH-KNOWLEDGE: passed/);
            times.push(result.durationMs);
          }
        },
        t,
      );
    }
    await hookTest(
      "check p95 across all twenty unfiltered processes",
      () => {
        t.assert.equal(times.length, budgets.timing.samples);
        t.diagnostic(
          `knowledge samples ${times.map((n) => n.toFixed(1)).join(" ")}`,
        );
        const sorted = [...times].sort((a, b) => a - b);
        const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
        t.diagnostic(
          `knowledge check p95 ${p95?.toFixed(1)} ms (${times.length} processes, ${load?.workers} load workers)`,
        );
        t.assert.equal(
          typeof p95 === "number" && p95 < budgets.timing.checkP95Ms,
          true,
          `HOOK-13: ${p95} < ${budgets.timing.checkP95Ms}`,
        );
      },
      t,
    );
  } finally {
    await load.stop();
  }
});
