import * as phases from "../../scripts/lib/test-phases.mjs";
import { selectTests, testPhases } from "../../scripts/lib/test-phases.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";

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

test("large ordinary files start first without changing measurement order or parallelism", (t) => {
  const small = hooks("small.test.mjs");
  const large = hooks("large.test.mjs");
  const measured = hooks("record-performance.test.mjs");
  const files = [small, measured, large];
  const sizes = new Map([
    [small, 10],
    [large, 1000],
    [measured, 2000],
  ]);
  t.assert.deepEqual(testPhases("hooks", files, 4, sizes), [
    { files: [large, small], concurrency: 4, budget: false },
    { files: [measured], concurrency: 1, budget: true },
  ]);
  t.assert.deepEqual(testPhases("scenario", [small, large], 4, sizes), [
    { files: [large, small], concurrency: 4, budget: false },
  ]);
  t.assert.deepEqual(files, [small, measured, large]);
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
  const distribution = ["claude", "codex", "cursor"].map(
    (name) => `/repo/tests/packaging/${name}.test.mjs`,
  );
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
    { suite: "packaging", files: [native, skills, ...distribution] },
    scenario,
    unit,
    hook,
  ];
  const groups = phases.testGroups(suites);
  t.assert.deepEqual(groups, [
    {
      suite: "checks",
      files: [content, registry],
    },
    unit,
    { suite: "packaging", files: [native] },
    {
      suite: "distribution",
      files: [skills, ...distribution, ...scenario.files],
    },
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
    { files: [content, registry], concurrency: 4, budget: false },
  ]);
  t.assert.deepEqual(testPhases("packaging", nativeFiles, 4), [
    { files: [native], concurrency: 1, budget: false },
  ]);
});

test("distribution and scenario share uninstrumented CPU slots while unit, cold probes and hooks retain distinct groups", (t) => {
  const suites = [
    {
      suite: "packaging",
      files: [
        "/repo/tests/packaging/native-environment.test.mjs",
        "/repo/tests/packaging/claude.test.mjs",
      ],
    },
    { suite: "scenario", files: ["/repo/tests/scenario/install.test.mjs"] },
    { suite: "unit", files: ["/repo/tests/unit/lib/io.test.mjs"] },
    {
      suite: "hooks",
      files: [hooks("io.test.mjs"), hooks("record-performance.test.mjs")],
    },
  ];
  const groups = phases.testGroups(suites);
  const combined = groups.find(({ suite }) => suite === "distribution");
  t.assert.deepEqual(combined?.files, [
    suites[0]?.files[1],
    suites[1]?.files[0],
  ]);
  t.assert.deepEqual(
    groups.flatMap(({ files }) => files).sort(),
    suites.flatMap(({ files }) => files).sort(),
  );
  t.assert.equal(new Set(groups.flatMap(({ files }) => files)).size, 6);
  t.assert.deepEqual(
    testPhases("distribution", combined?.files ?? [], 4).map(
      ({ concurrency, budget }) => ({ concurrency, budget }),
    ),
    [{ concurrency: 4, budget: false }],
  );
  t.assert.deepEqual(
    groups.filter(({ suite }) => suite === "unit" || suite === "hooks"),
    [suites[2], suites[3]],
  );
});

test("unit and hook selections retain their original coverage and measurement groups", (t) => {
  t.assert.equal(typeof phases.testGroups, "function");
  for (const suite of ["unit", "hooks"]) {
    const selected = [{ suite, files: [`/repo/tests/${suite}/io.test.mjs`] }];
    t.assert.deepEqual(phases.testGroups(selected), selected);
  }
});

test("a shared ordinary pool preserves every file, unit coverage, cold probes and separate performance", (t) => {
  const catalog = [
    { suite: "content", files: ["/repo/tests/content/one.test.mjs"] },
    {
      suite: "packaging",
      files: [
        "/repo/tests/packaging/native-environment.test.mjs",
        "/repo/tests/packaging/claude.test.mjs",
      ],
    },
    { suite: "unit", files: ["/repo/tests/unit/clock-performance.test.mjs"] },
    { suite: "scenario", files: ["/repo/tests/scenario/install.test.mjs"] },
    {
      suite: "hooks",
      files: [hooks("cursor.test.mjs"), hooks("record-performance.test.mjs")],
    },
  ];
  const ordinary = phases.testGroups(selectTests("ordinary", catalog), true);
  const integration = ordinary.find(({ suite }) => suite === "integration");
  t.assert.deepEqual(integration?.files, [
    catalog[1]?.files[1],
    catalog[3]?.files[0],
    catalog[4]?.files[0],
  ]);
  t.assert.deepEqual(
    testPhases("integration", integration?.files ?? [], 4).map(
      ({ concurrency, budget }) => ({ concurrency, budget }),
    ),
    [{ concurrency: 4, budget: false }],
  );
  t.assert.deepEqual(
    ordinary.find(({ suite }) => suite === "unit"),
    catalog[2],
  );
  t.assert.deepEqual(
    ordinary.find(({ suite }) => suite === "packaging")?.files,
    [catalog[1]?.files[0]],
  );
  const performance = phases.testGroups(selectTests("performance", catalog));
  t.assert.deepEqual(performance, [
    { suite: "hooks", files: [catalog[4]?.files[1]] },
  ]);
  const complete = [...ordinary, ...performance].flatMap(({ files }) => files);
  t.assert.deepEqual(
    complete.sort(),
    catalog.flatMap(({ files }) => files).sort(),
  );
  t.assert.equal(new Set(complete).size, complete.length);
  t.assert.deepEqual(selectTests("unit", catalog), [catalog[2]]);
  t.assert.deepEqual(selectTests("hooks", catalog), [catalog[4]]);
  t.assert.deepEqual(selectTests("checks", catalog), catalog.slice(0, 4));
  t.assert.deepEqual(selectTests(undefined, catalog), catalog);
  t.assert.throws(() => selectTests("unknown", catalog), /Unknown suite/);
});
