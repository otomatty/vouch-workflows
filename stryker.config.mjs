import budgets from "./core/registry/budgets.json" with { type: "json" };

export default {
  mutate: ["core/hooks/lib/**/*.mjs"],
  testRunner: "command",
  commandRunner: { command: "npm run test:unit" },
  coverageAnalysis: "off",
  reporters: ["clear-text", "html", "json"],
  thresholds: {
    high: budgets.mutation.score,
    low: budgets.mutation.score,
    break: budgets.mutation.score,
  },
  tempDirName: ".stryker-tmp",
};
