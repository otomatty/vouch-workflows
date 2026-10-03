// TEST-12 time budgets; the owner decision and measurements are in docs/development/check-budget.md.

/** @typedef {{testTimeoutMs:number,testFileTimeoutMs:number,checkTimeoutMs:{default:number,win32?:number}}} Timing */

/** Whole-check deadline for one OS: its own entry, else the default.
 * @param {Timing} timing @param {NodeJS.Platform} [platform] @returns {number} */
export function checkBudgetMs(timing, platform = process.platform) {
  return platform === "win32"
    ? (timing.checkTimeoutMs.win32 ?? timing.checkTimeoutMs.default)
    : timing.checkTimeoutMs.default;
}

/** Node 22 times out whole files; hookTest and scenario cases keep the five-second limit.
 * @param {string} suite @param {Timing} timing @returns {number} */
export function testTimeoutFor(suite, timing) {
  return ["hooks", "scenario", "distribution"].includes(suite)
    ? timing.testFileTimeoutMs
    : timing.testTimeoutMs;
}
