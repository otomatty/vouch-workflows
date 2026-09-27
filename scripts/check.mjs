import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import budgets from "../core/registry/budgets.json" with { type: "json" };

const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this check with npm run check.");
const start = performance.now();
for (const task of ["lint", "typecheck", "test"]) {
  const remaining = budgets.timing.checkTimeoutMs - (performance.now() - start);
  if (remaining <= 0)
    throw new Error("TEST-12: check exceeded its time budget.");
  const result = spawnSync(process.execPath, [npm, "run", task], {
    stdio: "inherit",
    timeout: Math.ceil(remaining),
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(`TEST-12: ${result.error.message}`);
    process.exit(result.status ?? 1);
  }
}
console.log(
  `Environment checks passed in ${((performance.now() - start) / 1000).toFixed(1)}s.`,
);
