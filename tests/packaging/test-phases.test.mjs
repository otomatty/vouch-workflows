import { test } from "node:test";
import * as phases from "../../scripts/lib/test-phases.mjs";
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

test("native shell lookup runs cold apart from the CPU-parallel packaging files", (t) => {
  const native = "/repo/tests/packaging/native-environment.test.mjs";
  const plain = "/repo/tests/packaging/skills.test.mjs";
  t.assert.deepEqual(testPhases("packaging", [native, plain], 4), [
    { files: [plain], concurrency: 4, budget: false },
    { files: [native], concurrency: 1, budget: false },
  ]);
});

test("identical validation settings share a phase without losing files or overlapping native probes", (t) => {
  t.assert.equal(typeof phases.testGroups, "function");
  const content = "/repo/tests/content/budgets.test.mjs";
  const registry = "/repo/tests/registry/schemas.test.mjs";
  const native = "/repo/tests/packaging/native-environment.test.mjs";
  const skills = "/repo/tests/packaging/skills.test.mjs";
  const scenario = {
    suite: "scenario",
    files: ["/repo/tests/scenario/git.test.mjs"],
  };
  const unit = { suite: "unit", files: ["/repo/tests/unit/git.test.mjs"] };
  const hook = {
    suite: "hooks",
    files: [hooks("git-guard-performance.test.mjs")],
  };
  const suites = [
    { suite: "content", files: [content] },
    { suite: "registry", files: [registry] },
    { suite: "packaging", files: [native, skills] },
    scenario,
    unit,
    hook,
  ];
  const groups = phases.testGroups(suites);
  t.assert.deepEqual(groups, [
    {
      suite: "checks",
      files: [content, registry, skills],
    },
    scenario,
    unit,
    { suite: "packaging", files: [native] },
    hook,
  ]);
  t.assert.deepEqual(
    groups.flatMap((group) => group.files).sort(),
    suites.flatMap((group) => group.files).sort(),
  );
  const sharedFiles =
    groups.find(({ suite }) => suite === "checks")?.files ?? [];
  const nativeFiles =
    groups.find(({ suite }) => suite === "packaging")?.files ?? [];
  t.assert.deepEqual(testPhases("checks", sharedFiles, 4), [
    { files: [content, registry, skills], concurrency: 4, budget: false },
  ]);
  t.assert.deepEqual(testPhases("packaging", nativeFiles, 4), [
    { files: [native], concurrency: 1, budget: false },
  ]);
});

test("unit and hook selections retain their original coverage and measurement groups", (t) => {
  t.assert.equal(typeof phases.testGroups, "function");
  for (const suite of ["unit", "hooks"]) {
    const selected = [{ suite, files: [`/repo/tests/${suite}/io.test.mjs`] }];
    t.assert.deepEqual(phases.testGroups(selected), selected);
  }
});
