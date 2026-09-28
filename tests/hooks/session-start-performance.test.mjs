import budgets from "../../core/registry/budgets.json" with { type: "json" };
import { cpuLoad } from "../helpers/cpu-load.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { runHook, sandbox, sessionFor } from "../helpers/runtime.mjs";

test("recording startup stays below the p95 budget over twenty process executions", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root);
  /** @type {number[]} */ const times = [];
  t.plan(budgets.timing.samples * 2 + 1);
  // HOOK-13 condition: CPU count - 1 processes keep starting no-op hooks meanwhile.
  const load = await cpuLoad(t);
  try {
    for (let i = 0; i < budgets.timing.samples; i++) {
      const result = runHook(
        "vouch-record-session-start",
        {
          ...fixture,
          payload: { ...fixture.payload, session_id: `timing-${i}` },
        },
        { root: box.root, intent: "260927-orders", coverage: false },
      );
      t.assert.equal(result.exitCode, 0);
      t.assert.equal(result.stderr, "");
      times.push(result.durationMs);
    }
  } finally {
    await load.stop();
  }
  // Raw samples in execution order, so a cold or contended tail is visible in CI logs.
  t.diagnostic(`record samples ${times.map((ms) => ms.toFixed(1)).join(" ")}`);
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  t.diagnostic(`record p95 ${p95?.toFixed(1)} ms (${times.length} executions)`);
  t.assert.equal(
    typeof p95 === "number" && p95 < budgets.timing.recordP95Ms,
    true,
    `HOOK-13: ${p95} < ${budgets.timing.recordP95Ms}`,
  );
});
