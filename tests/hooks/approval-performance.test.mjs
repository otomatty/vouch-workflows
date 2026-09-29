import budgets from "../../core/registry/budgets.json" with { type: "json" };
import { cpuLoad } from "../helpers/cpu-load.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import {
  approvalBox,
  artifact,
  audit,
  intent,
  planned,
} from "../helpers/intent-review.mjs";
import { runHook } from "../helpers/runtime.mjs";
import { toolFixture } from "../helpers/write-guard.mjs";

/** @param {import('node:test').TestContext} t @param {number[]} times @param {string} name @param {number} budget */
function p95(t, times, name, budget) {
  t.diagnostic(`${name} samples ${times.map((ms) => ms.toFixed(1)).join(" ")}`);
  const sorted = [...times].sort((a, b) => a - b);
  const value = sorted[Math.ceil(sorted.length * 0.95) - 1];
  t.diagnostic(
    `${name} p95 ${value?.toFixed(1)} ms (${sorted.length} executions)`,
  );
  t.assert.equal(
    typeof value === "number" && value < budget,
    true,
    `HOOK-13: ${value} < ${budget}`,
  );
}

test("applying an approval stays below the record p95 budget over twenty process executions", async (t) => {
  const box = await approvalBox(t);
  for (const target of ["acceptance", "scope"]) box.confirm(target);
  box.send("vouch review");
  const gate = (await box.rows()).find((row) => row.type === "gate.opened");
  box.send(`vouch approve ${gate?.id}`);
  const pending = await box.read(audit);
  /** @type {number[]} */ const times = [];
  t.plan(budgets.timing.samples * 2 + 1);
  // HOOK-13 condition: CPU count - 1 processes keep starting no-op hooks meanwhile.
  const load = await cpuLoad(t);
  try {
    for (let index = 0; index < budgets.timing.samples; index++) {
      await box.write(audit, pending);
      await box.write(artifact, planned());
      const result = runHook(
        "vouch-record-intent-review",
        box.fixture("vouch confirm units", `timing-${index}`),
        { root: box.root, intent, coverage: false },
      );
      t.assert.equal(result.exitCode, 2);
      t.assert.match(
        result.stderr,
        /; units; approval evt_[a-f0-9]{64} applied/,
      );
      times.push(result.durationMs);
    }
  } finally {
    await load.stop();
  }
  p95(t, times, "apply record", budgets.timing.recordP95Ms);
});

test("guarding an implementation write against an approved plan stays below the check p95 budget", async (t) => {
  const box = await approvalBox(t);
  await box.approveAfter();
  /** @type {number[]} */ const times = [];
  t.plan(budgets.timing.samples * 2 + 1);
  const load = await cpuLoad(t);
  try {
    for (let index = 0; index < budgets.timing.samples; index++) {
      const result = runHook(
        "vouch-guard-writes",
        toolFixture("claude", "Write", box.root, {
          file_path: box.path(`src/app-${index}.js`),
          content: "x\n",
        }),
        { root: box.root, intent, coverage: false },
      );
      t.assert.equal(result.exitCode, 0);
      t.assert.equal(result.stderr, "");
      times.push(result.durationMs);
    }
  } finally {
    await load.stop();
  }
  p95(t, times, "build guard", budgets.timing.checkP95Ms);
});
