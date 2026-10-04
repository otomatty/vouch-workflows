// HOOK-13 budget files; see docs/development/hook-startup.md.
const budget = /-performance\.test\.mjs$/;
const nativeFile = /[/\\]native-environment\.test\.mjs$/;

/** Keep the existing individual selections and partition the complete check without omissions.
 * @param {string|undefined} selected @param {{suite:string,files:string[]}[]} catalog */
export function selectTests(selected, catalog) {
  if (
    selected &&
    !["unit", "hooks", "checks", "ordinary", "performance"].includes(selected)
  )
    throw new Error(`Unknown suite: ${selected}`);
  return catalog
    .filter(({ suite }) =>
      selected === "unit"
        ? suite === "unit"
        : selected === "hooks" || selected === "performance"
          ? suite === "hooks"
          : selected === "checks"
            ? suite !== "hooks"
            : true,
    )
    .map(({ suite, files }) => ({
      suite,
      files:
        suite === "hooks" && selected === "ordinary"
          ? files.filter((file) => !budget.test(file))
          : selected === "performance"
            ? files.filter((file) => budget.test(file))
            : files,
    }));
}

/** Combine only tiers with identical timeout and coverage settings.
 * @param {{suite:string,files:string[]}[]} suites @param {boolean} [mergeHooks]
 * @returns {{suite:string,files:string[]}[]}
 */
export function testGroups(suites, mergeHooks = false) {
  const shared = suites.filter(({ suite }) =>
    ["content", "registry", "packaging"].includes(suite),
  );
  if (shared.length === 0) return suites;
  const native = shared
    .filter(({ suite }) => suite === "packaging")
    .flatMap(({ files }) => files.filter((file) => nativeFile.test(file)));
  const distribution = shared
    .filter(({ suite }) => suite === "packaging")
    .flatMap(({ files }) => files.filter((file) => !nativeFile.test(file)));
  const hooks = suites.filter(({ suite }) => suite === "hooks");
  const ordinaryHooks = mergeHooks
    ? hooks.flatMap(({ files }) => files.filter((file) => !budget.test(file)))
    : [];
  return [
    {
      suite: "checks",
      files: shared.flatMap(({ files }) =>
        files.filter(
          (file) => !native.includes(file) && !distribution.includes(file),
        ),
      ),
    },
    ...suites.filter(
      (group) =>
        !shared.includes(group) && !["hooks", "scenario"].includes(group.suite),
    ),
    { suite: "packaging", files: native },
    {
      suite: ordinaryHooks.length ? "integration" : "distribution",
      files: [
        ...distribution,
        ...suites
          .filter(({ suite }) => suite === "scenario")
          .flatMap(({ files }) => files),
        ...ordinaryHooks,
      ],
    },
    ...hooks.map(({ suite, files }) => ({
      suite,
      files: mergeHooks ? files.filter((file) => budget.test(file)) : files,
    })),
  ].filter(({ files }) => files.length > 0);
}

/**
 * Phases of one test tier. The hooks budget files run last, one file at a time, under the
 * synthetic CPU load they start themselves; every other file runs CPU-parallel.
 * @param {string} suite
 * @param {string[]} files
 * @param {number} cpus
 * @param {ReadonlyMap<string,number>} [sizes] Source sizes for scheduling ordinary files first.
 * @returns {{files:string[],concurrency:number,budget:boolean}[]}
 */
export function testPhases(suite, files, cpus, sizes = new Map()) {
  const budgets =
    suite === "hooks" ? files.filter((file) => budget.test(file)) : [];
  const native =
    suite === "packaging" ? files.filter((file) => nativeFile.test(file)) : [];
  return [
    {
      files: files
        .filter((file) => !budgets.includes(file) && !native.includes(file))
        .sort((a, b) => (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0)),
      concurrency: cpus,
      budget: false,
    },
    { files: budgets, concurrency: 1, budget: true },
    { files: native, concurrency: 1, budget: false },
  ].filter((phase) => phase.files.length > 0);
}
