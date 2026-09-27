import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import budgets from "../core/registry/budgets.json" with { type: "json" };

/** @param {string} directory */
function files(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
}

const selected = process.argv[2];
if (selected && !["unit", "hooks"].includes(selected)) {
  throw new Error(`Unknown suite: ${selected}`);
}
const suites = selected
  ? [selected]
  : ["content", "registry", "packaging", "scenario", "unit", "hooks"];
for (const suite of suites) {
  const tests = files(`tests/${suite}`);
  if (tests.length === 0) {
    if (selected) throw new Error(`No tests implemented for ${suite}.`);
    console.log(`No ${suite} tests yet.`);
    continue;
  }
  const flags = [
    "--test",
    `--test-timeout=${budgets.timing.testTimeoutMs}`,
    `--test-concurrency=${availableParallelism()}`,
    "--import=./tests/helpers/no-network.mjs",
  ];
  const productHooks = readdirSync("core/hooks").some((name) =>
    name.endsWith(".mjs"),
  );
  if (suite === "hooks" && !productHooks)
    console.log(
      "Transport tests only; product hook coverage is not measured yet.",
    );
  if (suite === "unit" || (suite === "hooks" && productHooks)) {
    const coverage =
      suite === "unit" ? budgets.coverage.lib : budgets.coverage.hooks;
    flags.push(
      "--experimental-test-coverage",
      `--test-coverage-include=${suite === "unit" ? "core/hooks/lib/**/*.mjs" : "core/hooks/*.mjs"}`,
      `--test-coverage-lines=${coverage.lines}`,
      `--test-coverage-branches=${coverage.branches}`,
    );
    if (suite === "unit")
      flags.push(`--test-coverage-functions=${budgets.coverage.lib.functions}`);
  }
  const result = spawnSync(process.execPath, [...flags, ...tests], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
