import budgets from "../../core/registry/budgets.json" with { type: "json" };
import { hookTest as test } from "../helpers/hook-test.mjs";
import { intent, reviewBox } from "../helpers/intent-review.mjs";
import { runHook } from "../helpers/runtime.mjs";

for (const operation of ["open", "approve"])
  test(`${operation} recording stays below the p95 budget over twenty process executions`, async (t) => {
    const box = await reviewBox(t);
    box.submit("vouch review");
    const [gate] = await box.rows();
    if (!gate) throw Error("gate");
    /** @type {number[]} */ const times = [];
    t.plan(budgets.timing.samples * 2 + 1);
    for (let index = 0; index < budgets.timing.samples; index++) {
      const fixture = box.fixture(
        operation === "open" ? "vouch review" : `vouch approve ${gate.id}`,
        `timing-${index}`,
      );
      const result = runHook("vouch-record-intent-review", fixture, {
        root: box.root,
        intent,
        coverage: false,
      });
      t.assert.equal(result.exitCode, 2);
      t.assert.match(
        result.stderr,
        operation === "open"
          ? /VOUCH-REVIEW-RECORDED/
          : /VOUCH-APPROVAL-RECORDED/,
      );
      times.push(result.durationMs);
    }
    // Raw samples in execution order, so a cold or contended tail is visible in CI logs.
    t.diagnostic(
      `${operation} record samples ${times.map((ms) => ms.toFixed(1)).join(" ")}`,
    );
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    t.diagnostic(
      `${operation} record p95 ${p95?.toFixed(1)} ms (${times.length} executions)`,
    );
    t.assert.equal(
      typeof p95 === "number" && p95 < budgets.timing.recordP95Ms,
      true,
      `HOOK-13: ${p95} < ${budgets.timing.recordP95Ms}`,
    );
  });
