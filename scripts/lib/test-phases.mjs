// HOOK-13 budget files; see docs/development/hook-startup.md.
const budget = /-performance\.test\.mjs$/;
const nativeFile = /[/\\]native-environment\.test\.mjs$/;

/** Combine only tiers with identical timeout and coverage settings.
 * @param {{suite:string,files:string[]}[]} suites
 * @returns {{suite:string,files:string[]}[]}
 */
export function testGroups(suites) {
  const shared = suites.filter(({ suite }) =>
    ["content", "registry", "packaging"].includes(suite),
  );
  if (shared.length === 0) return suites;
  const native = shared
    .filter(({ suite }) => suite === "packaging")
    .flatMap(({ files }) => files.filter((file) => nativeFile.test(file)));
  return [
    {
      suite: "checks",
      files: shared.flatMap(({ files }) =>
        files.filter((file) => !native.includes(file)),
      ),
    },
    ...suites.filter(
      (group) =>
        !shared.includes(group) && !["hooks", "scenario"].includes(group.suite),
    ),
    { suite: "packaging", files: native },
    ...suites.filter(({ suite }) => suite === "scenario"),
    ...suites.filter(({ suite }) => suite === "hooks"),
  ].filter(({ files }) => files.length > 0);
}

/**
 * Phases of one test tier. The hooks budget files run last, one file at a time, under the
 * synthetic CPU load they start themselves; every other file runs CPU-parallel.
 * @param {string} suite
 * @param {string[]} files
 * @param {number} cpus
 * @returns {{files:string[],concurrency:number,budget:boolean}[]}
 */
export function testPhases(suite, files, cpus) {
  const budgets =
    suite === "hooks" ? files.filter((file) => budget.test(file)) : [];
  const native =
    suite === "packaging" ? files.filter((file) => nativeFile.test(file)) : [];
  return [
    {
      files: files.filter(
        (file) => !budgets.includes(file) && !native.includes(file),
      ),
      concurrency: cpus,
      budget: false,
    },
    { files: budgets, concurrency: 1, budget: true },
    { files: native, concurrency: 1, budget: false },
  ].filter((phase) => phase.files.length > 0);
}
