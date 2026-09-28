import { test } from "node:test";
import { testPhases } from "../../scripts/lib/test-phases.mjs";

const hooks = (/** @type {string} */ name) => `/repo/tests/hooks/${name}`;

test("hooks budget files run last, one file at a time, apart from the CPU-parallel phase", (t) => {
  const files = [
    hooks("codex-session-start.test.mjs"),
    hooks("intent-review-performance.test.mjs"),
    hooks("io.test.mjs"),
    hooks("session-start-performance.test.mjs"),
  ];
  t.plan(1);
  t.assert.deepEqual(testPhases("hooks", files, 4), [
    {
      files: [hooks("codex-session-start.test.mjs"), hooks("io.test.mjs")],
      concurrency: 4,
      budget: false,
    },
    {
      files: [
        hooks("intent-review-performance.test.mjs"),
        hooks("session-start-performance.test.mjs"),
      ],
      concurrency: 1,
      budget: true,
    },
  ]);
});

test("other tiers and hooks without budget files keep one CPU-parallel phase", (t) => {
  const unit = ["/repo/tests/unit/lib/clock-performance.test.mjs"];
  const plain = [hooks("io.test.mjs")];
  t.plan(2);
  t.assert.deepEqual(testPhases("unit", unit, 8), [
    { files: unit, concurrency: 8, budget: false },
  ]);
  t.assert.deepEqual(testPhases("hooks", plain, 2), [
    { files: plain, concurrency: 2, budget: false },
  ]);
});
