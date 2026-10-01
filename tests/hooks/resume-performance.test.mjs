import budgets from "../../core/registry/budgets.json" with { type: "json" };
import { cpuLoad } from "../helpers/cpu-load.mjs";
import { deriveFixture } from "../helpers/fixtures.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { planned } from "../helpers/intent-review.mjs";
import { readJson } from "../helpers/registry.mjs";
import {
  asked,
  auditPath,
  card,
  decisions,
  defaulted,
  home,
  intent,
  jsonl,
} from "../helpers/resume.mjs";
import { runHook, sandbox } from "../helpers/runtime.mjs";

/** @param {number[]} times */
function p95(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

/** @param {import('node:test').TestContext} t */
async function project(t) {
  const box = await sandbox(t);
  const questions = Array.from({ length: 40 }, (_, i) => asked(`Q-${i + 1}`));
  await box.write(`${home}/intent.md`, planned());
  await box.write(`${home}/decisions.md`, decisions(card()));
  await box.write(
    auditPath,
    jsonl([...questions, ...questions.slice(0, 20).map(defaulted)]),
  );
  return box;
}

/**
 * @param {import('node:test').TestContext} t @param {string} hook @param {string} capture
 */
async function measure(t, hook, capture) {
  const box = await project(t);
  const fixture = deriveFixture(
    readJson(
      `tests/fixtures/harness/claude/2.1.283/linux/print/${capture}.json`,
    ),
    { cwd: box.root },
  );
  /** @type {number[]} */ const times = [];
  t.plan(budgets.timing.samples * 2 + 1);
  // HOOK-13 condition: CPU count - 1 processes keep starting no-op hooks meanwhile.
  const load = await cpuLoad(t);
  t.diagnostic(
    `load ${load.workers} processes ready in ${load.readyMs.toFixed(0)} ms`,
  );
  try {
    for (let i = 0; i < budgets.timing.samples; i++) {
      const result = runHook(hook, fixture, {
        root: box.root,
        intent,
        coverage: false,
      });
      t.assert.equal(result.exitCode, 0);
      t.assert.equal(result.stderr, "");
      times.push(result.durationMs);
    }
  } finally {
    await load.stop();
  }
  // Raw samples in execution order, so a cold or contended tail is visible in CI logs.
  t.diagnostic(`record samples ${times.map((ms) => ms.toFixed(1)).join(" ")}`);
  const value = p95(times);
  t.diagnostic(
    `record p95 ${value?.toFixed(1)} ms (${times.length} executions)`,
  );
  t.assert.equal(
    typeof value === "number" && value < budgets.timing.recordP95Ms,
    true,
    `HOOK-13: ${value} < ${budgets.timing.recordP95Ms}`,
  );
}

test("the resume summary of a populated Intent stays below the record p95 budget", (t) =>
  measure(t, "vouch-record-session-start", "SessionStart.resume"));

test("the Stop recorder stays below the record p95 budget", (t) =>
  measure(t, "vouch-record-aside-answer", "Stop"));
