import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import budgets from "../core/registry/budgets.json" with { type: "json" };
import { checkBudgetMs } from "./lib/time-budgets.mjs";

const npm = process.env.npm_execpath ?? "";
if (!npm) throw new Error("Run this check with npm run check.");
const budget = checkBudgetMs(budgets.timing);
const start = performance.now();
/** Run one task within the original shared deadline. @param {string} task @returns {Promise<number>} */
async function runTask(task) {
  const remaining = budget - (performance.now() - start);
  if (remaining <= 0)
    throw new Error("TEST-12: check exceeded its time budget.");
  return new Promise((done) => {
    const child = spawn(process.execPath, [npm, "run", task], {
      stdio: "inherit",
      timeout: Math.ceil(remaining),
      windowsHide: true,
    });
    child.once("error", (error) => {
      console.error(`TEST-12: ${task}: ${error.message}`);
      done(1);
    });
    child.once("exit", (code) => {
      if (child.killed && code === null)
        console.error(`TEST-12: ${task} exceeded the remaining check budget`);
      done(code ?? 1);
    });
  });
}
// These read the project or use isolated sandboxes. Hooks require every result first,
// keeping static checks and other tiers out of the performance measurements.
const staticResults = await Promise.all(
  ["lint", "typecheck", "test:checks"].map(runTask),
);
const failure = staticResults.find((status) => status !== 0);
if (failure !== undefined) process.exit(failure);
for (const task of ["test:hooks", "package", "package:check"]) {
  const status = await runTask(task);
  if (status !== 0) process.exit(status);
}
console.log(
  `Implemented checks passed in ${((performance.now() - start) / 1000).toFixed(1)}s (budget ${budget / 1000}s).`,
);
