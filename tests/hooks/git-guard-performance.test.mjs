import budgets from "../../core/registry/budgets.json" with { type: "json" };
import { cpuLoad } from "../helpers/cpu-load.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { runHook, sandbox } from "../helpers/runtime.mjs";
import { toolFixture } from "../helpers/write-guard.mjs";

// The Git stage without a Git process; Git reads are measured apart (docs/development/git-guard.md).
test("refusing a named push to main stays below the check p95 budget over twenty process executions", async (t) => {
  const box = await sandbox(t, { git: false });
  /** @type {number[]} */ const times = [];
  t.plan(budgets.timing.samples * 2 + 1);
  // HOOK-13 condition: CPU count - 1 processes keep starting no-op hooks meanwhile.
  const load = await cpuLoad(t);
  t.diagnostic(
    `load ${load.workers} processes ready in ${load.readyMs.toFixed(0)} ms`,
  );
  try {
    for (let i = 0; i < budgets.timing.samples; i++) {
      const result = runHook(
        "vouch-guard-writes",
        toolFixture("claude", "Bash", box.root, {
          command: `git push -u origin HEAD:main # ${i}`,
        }),
        { root: box.root, coverage: false },
      );
      t.assert.equal(result.exitCode, 2);
      t.assert.match(
        result.stderr,
        /^VOUCH-GIT-PUSH: Bash git push -u origin HEAD:main; main is protected/,
      );
      times.push(result.durationMs);
    }
  } finally {
    await load.stop();
  }
  t.diagnostic(`git samples ${times.map((ms) => ms.toFixed(1)).join(" ")}`);
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  t.diagnostic(`git p95 ${p95?.toFixed(1)} ms (${times.length} executions)`);
  t.assert.equal(
    typeof p95 === "number" && p95 < budgets.timing.checkP95Ms,
    true,
    `HOOK-13: ${p95} < ${budgets.timing.checkP95Ms}`,
  );
});
