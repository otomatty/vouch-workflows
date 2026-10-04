import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import budgets from "../core/registry/budgets.json" with { type: "json" };
import { createInstallationFixture } from "./lib/installation-fixture.mjs";
import { selectTests, testGroups, testPhases } from "./lib/test-phases.mjs";
import { testSourceSizes } from "./lib/test-source-size.mjs";
import { testTimeoutFor } from "./lib/time-budgets.mjs";

/** @param {string} directory */
function files(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
}

const selected = process.argv[2];
const checks = ["content", "registry", "packaging", "scenario", "unit"];
const suites = selectTests(
  selected,
  [...checks, "hooks"].map((suite) => ({
    suite,
    files: files(`tests/${suite}`),
  })),
);
// A failing suite must not hide the results of later suites; the run still fails.
/** @type {string[]} */ const failed = [];
const groups = testGroups(suites, !selected || selected === "ordinary");
const fixture = groups.some(
  ({ suite, files }) =>
    ["distribution", "integration"].includes(suite) ||
    (suite === "hooks" &&
      files.some((file) => !file.endsWith("-performance.test.mjs"))),
)
  ? createInstallationFixture()
  : null;
try {
  for (const { suite, files: tests } of groups) {
    if (tests.length === 0) {
      if (selected) throw new Error(`No tests implemented for ${suite}.`);
      console.log(`No ${suite} tests yet.`);
      continue;
    }
    const productHooks = readdirSync("core/hooks").filter((name) =>
      name.endsWith(".mjs"),
    );
    const hookCoverage = ["hooks", "integration"].includes(suite);
    if (hookCoverage && productHooks.length === 0)
      console.log(
        "Transport tests only; product hook coverage is not measured yet.",
      );
    // HOOK-13 budget files run last and alone, under the load they start themselves.
    const sizes = ["scenario", "distribution", "hooks", "integration"].includes(
      suite,
    )
      ? testSourceSizes(
          tests.filter(
            (file) =>
              suite !== "hooks" || !file.endsWith("-performance.test.mjs"),
          ),
          resolve("tests/helpers"),
        )
      : undefined;
    for (const phase of testPhases(
      suite,
      tests,
      availableParallelism(),
      sizes,
    )) {
      /** @type {import('node:test').RunOptions} */
      const options = {
        files: phase.files,
        timeout: testTimeoutFor(suite, budgets.timing),
        concurrency: phase.concurrency,
        execArgv: [
          "--import",
          pathToFileURL(resolve("tests/helpers/no-network.mjs")).href,
        ],
      };
      const measured =
        !phase.budget &&
        (suite === "unit" || (hookCoverage && productHooks.length > 0));
      if (measured) {
        const coverage =
          suite === "unit" ? budgets.coverage.lib : budgets.coverage.hooks;
        options.coverage = true;
        options.coverageIncludeGlobs =
          suite === "unit" ? "core/hooks/lib/**/*.mjs" : "core/hooks/*.mjs";
        options.lineCoverage = coverage.lines;
        options.branchCoverage = coverage.branches;
        if (suite === "unit")
          options.functionCoverage = budgets.coverage.lib.functions;
      }
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/test-phase.mjs"), JSON.stringify(options)],
        {
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          env: {
            ...process.env,
            ...(fixture ? { VOUCH_TEST_DISTRIBUTION: fixture.root } : {}),
          },
        },
      );
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      if (result.error) throw result.error;
      if (hookCoverage && measured) {
        for (const name of productHooks) {
          const covered = result.stdout
            .split("\n")
            .some(
              (line) =>
                line.includes(name) && /\|\s*\d+(?:\.\d+)?\s*\|/.test(line),
            );
          if (!covered)
            throw new Error(`TEST-8: no child process coverage for ${name}`);
        }
      }
      if (result.status !== 0 && !failed.includes(suite)) failed.push(suite);
    }
  }
} finally {
  fixture?.dispose();
}
if (failed.length > 0) {
  console.error(`Failed test suites: ${failed.join(", ")}`);
  process.exit(1);
}
