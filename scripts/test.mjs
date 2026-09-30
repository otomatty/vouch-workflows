import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import budgets from "../core/registry/budgets.json" with { type: "json" };
import { testGroups, testPhases } from "./lib/test-phases.mjs";

/** @param {string} directory */
function files(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
}

const selected = process.argv[2];
if (selected && !["unit", "hooks", "checks"].includes(selected)) {
  throw new Error(`Unknown suite: ${selected}`);
}
const checks = ["content", "registry", "packaging", "scenario", "unit"];
const suites =
  selected === "checks" ? checks : selected ? [selected] : [...checks, "hooks"];
// A failing suite must not hide the results of later suites; the run still fails.
/** @type {string[]} */ const failed = [];
const groups = testGroups(
  suites.map((suite) => ({ suite, files: files(`tests/${suite}`) })),
);
for (const { suite, files: tests } of groups) {
  if (tests.length === 0) {
    if (selected) throw new Error(`No tests implemented for ${suite}.`);
    console.log(`No ${suite} tests yet.`);
    continue;
  }
  const productHooks = readdirSync("core/hooks").filter((name) =>
    name.endsWith(".mjs"),
  );
  if (suite === "hooks" && productHooks.length === 0)
    console.log(
      "Transport tests only; product hook coverage is not measured yet.",
    );
  // HOOK-13 budget files run last and alone, under the load they start themselves.
  for (const phase of testPhases(suite, tests, availableParallelism())) {
    const flags = [
      "--test",
      // Node 22 times out the whole file; hookTest enforces five seconds per hook/scenario case.
      `--test-timeout=${["hooks", "scenario"].includes(suite) ? budgets.timing.checkTimeoutMs : budgets.timing.testTimeoutMs}`,
      `--test-concurrency=${phase.concurrency}`,
      "--import=./tests/helpers/no-network.mjs",
    ];
    const measured =
      !phase.budget &&
      (suite === "unit" || (suite === "hooks" && productHooks.length > 0));
    if (measured) {
      const coverage =
        suite === "unit" ? budgets.coverage.lib : budgets.coverage.hooks;
      flags.push(
        "--experimental-test-coverage",
        `--test-coverage-include=${suite === "unit" ? "core/hooks/lib/**/*.mjs" : "core/hooks/*.mjs"}`,
        `--test-coverage-lines=${coverage.lines}`,
        `--test-coverage-branches=${coverage.branches}`,
      );
      if (suite === "unit")
        flags.push(
          `--test-coverage-functions=${budgets.coverage.lib.functions}`,
        );
    }
    const result = spawnSync(process.execPath, [...flags, ...phase.files], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (result.error) throw result.error;
    if (suite === "hooks" && measured) {
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
if (failed.length > 0) {
  console.error(`Failed test suites: ${failed.join(", ")}`);
  process.exit(1);
}
