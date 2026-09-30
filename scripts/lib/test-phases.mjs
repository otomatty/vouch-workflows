// HOOK-13 budget files; see docs/development/hook-startup.md.
const budget = /-performance\.test\.mjs$/;

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
    suite === "packaging"
      ? files.filter((file) => /[/\\]native-environment\.test\.mjs$/.test(file))
      : [];
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
