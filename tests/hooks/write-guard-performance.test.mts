import budgets from "../../core/registry/budgets.json" with { type: "json" };
import { cpuLoad } from "../helpers/cpu-load.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { runHook } from "../helpers/runtime.mjs";
import { audit, guardBox, toolFixture } from "../helpers/write-guard.mjs";

test("guarding a shell write stays below the check p95 budget over twenty process executions", async (t) => {
  const box = await guardBox(t);
  const times: number[] = [];
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
          command: `cd vouch && cat intents/*/intent.md && printf '%s\\n' ${i} >> ${audit}`,
        }),
        { root: box.root, coverage: false },
      );
      t.assert.equal(result.exitCode, 2);
      t.assert.match(result.stderr, /^VOUCH-GUARD-AUDIT: /);
      times.push(result.durationMs);
    }
  } finally {
    await load.stop();
  }
  t.diagnostic(`guard samples ${times.map((ms) => ms.toFixed(1)).join(" ")}`);
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  t.diagnostic(`guard p95 ${p95?.toFixed(1)} ms (${times.length} executions)`);
  t.assert.equal(
    typeof p95 === "number" && p95 < budgets.timing.checkP95Ms,
    true,
    `HOOK-13: ${p95} < ${budgets.timing.checkP95Ms}`,
  );
});
