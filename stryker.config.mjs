import budgets from "./core/registry/budgets.json" with { type: "json" };

export default {
  mutate: ["core/hooks/lib/**/*.mts"],
  testRunner: "command",
  // Mutants live in the .mts sources; the build carries them into the tested .mjs.
  commandRunner: { command: "npm run build && npm run test:unit" },
  coverageAnalysis: "off",
  reporters: ["clear-text", "html", "json"],
  thresholds: {
    high: budgets.mutation.score,
    low: budgets.mutation.score,
    break: budgets.mutation.score,
  },
  tempDirName: ".stryker-tmp",
};
