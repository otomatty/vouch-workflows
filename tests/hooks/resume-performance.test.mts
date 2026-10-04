import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { newId } from "../../core/hooks/lib/clock.mjs";
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

function p95(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

async function project(t: import("node:test").TestContext) {
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

/** @param steps Untimed per-sample setup and a final check. */
async function measure(
  t: import("node:test").TestContext,
  hook: string,
  capture: string,
  steps: {
    prepare?: (
      i: number,
      box: { root: string },
      payload: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    after?: (box: { read: (path: string) => Promise<string> }) => Promise<void>;
  } = {},
) {
  const box = await project(t);
  const fixture = deriveFixture(
    readJson(
      `tests/fixtures/harness/claude/2.1.283/linux/print/${capture}.json`,
    ),
    { cwd: box.root },
  );
  const times: number[] = [];
  t.plan(budgets.timing.samples * 2 + 1 + (steps.after ? 1 : 0));
  // HOOK-13 condition: CPU count - 1 processes keep starting no-op hooks meanwhile.
  const load = await cpuLoad(t);
  t.diagnostic(
    `load ${load.workers} processes ready in ${load.readyMs.toFixed(0)} ms`,
  );
  try {
    for (let i = 0; i < budgets.timing.samples; i++) {
      const payload = steps.prepare
        ? await steps.prepare(i, box, fixture.payload)
        : fixture.payload;
      const result = runHook(
        hook,
        { ...fixture, payload: payload as never },
        {
          root: box.root,
          intent,
          coverage: false,
        },
      );
      t.assert.equal(result.exitCode, 0);
      t.assert.equal(result.stderr, "");
      times.push(result.durationMs);
    }
  } finally {
    await load.stop();
  }
  await steps.after?.(box);
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

test("the Stop recorder appending each answer stays below the record p95 budget", (t) =>
  measure(t, "vouch-record-aside-answer", "Stop", {
    // Each sample's turn has a fresh unanswered ask, so every run takes the locked append path.
    prepare: async (i, box, payload) => {
      const session = String(payload.session_id);
      const turn = `timing-${i}`;
      await appendFile(
        join(box.root, auditPath),
        `${JSON.stringify({
          id: newId(
            session,
            JSON.stringify([
              "aside.asked",
              "claude",
              intent,
              "prompt_id",
              turn,
            ]),
          ),
          v: 1,
          type: "aside.asked",
          ts: "2026-09-27T00:00:00.000Z",
          actor: "human",
          harness: "claude",
          intent,
          session,
          question: "why?",
        })}\n`,
      );
      return { ...payload, prompt_id: turn };
    },
    after: async (box) => {
      const answered = (await box.read(auditPath))
        .trim()
        .split("\n")
        .filter((line) => JSON.parse(line).type === "aside.answered");
      t.assert.equal(answered.length, budgets.timing.samples);
    },
  }));
