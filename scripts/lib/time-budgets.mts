// TEST-12 time budgets; the owner decision and measurements are in docs/development/check-budget.md.

export type Timing = {
  testTimeoutMs: number;
  testFileTimeoutMs: number;
  checkTimeoutMs: { default: number; win32?: number };
};

/** Whole-check deadline for one OS: its own entry, else the default. */
export function checkBudgetMs(
  timing: Timing,
  platform: NodeJS.Platform = process.platform,
): number {
  return platform === "win32"
    ? (timing.checkTimeoutMs.win32 ?? timing.checkTimeoutMs.default)
    : timing.checkTimeoutMs.default;
}

/** Node 22 times out whole files; hookTest and scenario cases keep the five-second limit. */
export function testTimeoutFor(suite: string, timing: Timing): number {
  return ["hooks", "scenario"].includes(suite)
    ? timing.testFileTimeoutMs
    : timing.testTimeoutMs;
}
