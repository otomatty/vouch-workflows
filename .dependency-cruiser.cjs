/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "STR-2-knowledge-inspection-direction",
      severity: "error",
      from: {
        path: "^core/hooks/lib/(knowledge|freshness|citation|questions)\\.mjs$",
      },
      to: { path: "^core/hooks/(?:lib/knowledge-check\\.mjs|[^/]+\\.mjs)$" },
    },
    {
      name: "STR-2-no-cycles",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "STR-2-resolved-imports",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "HOOK-1-no-runtime-packages",
      severity: "error",
      from: { path: "^core/hooks/" },
      to: {
        dependencyTypes: [
          "npm",
          "npm-dev",
          "npm-optional",
          "npm-peer",
          "npm-no-pkg",
        ],
      },
    },
    {
      name: "STR-2-hooks-only-import-lib",
      severity: "error",
      from: { path: "^core/hooks/[^/]+\\.mjs$" },
      to: { pathNot: "^core/hooks/lib/" },
    },
    {
      name: "STR-2-lib-boundary",
      severity: "error",
      from: { path: "^core/hooks/lib/" },
      to: {
        pathNot: "^(core/hooks/lib/|core/registry/[^/]+\\.json$)",
        dependencyTypesNot: ["core"],
      },
    },
    {
      name: "HOOK-5-no-network",
      severity: "error",
      from: { path: "^core/hooks/" },
      to: { path: "^(node:)?(http|https|http2|net|tls|dns|dgram)(/|$)" },
    },
    {
      name: "HOOK-6-fs-boundary",
      severity: "error",
      from: { path: "^core/hooks/", pathNot: "^core/hooks/lib/fs\\.mjs$" },
      to: { path: "^(node:)?fs(/|$)" },
    },
    {
      name: "TEST-3-hooks-use-processes",
      severity: "error",
      from: { path: "^tests/hooks/" },
      to: { path: "^core/hooks/[^/]+\\.mjs$" },
    },
    {
      name: "TEST-3-unit-no-processes",
      severity: "error",
      from: { path: "^tests/unit/" },
      to: { path: "^(node:)?child_process$" },
    },
    {
      name: "TEST-13-content-only",
      severity: "error",
      from: { path: "^tests/", pathNot: "^tests/content/" },
      to: { path: "^core/skills/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: "^(docs|dist|tests/fixtures|tests/golden|tests/eval)/",
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default"],
    },
  },
};
