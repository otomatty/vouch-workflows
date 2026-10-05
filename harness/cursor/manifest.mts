import cursorAgent from "./agent-markdown.mjs";

export default {
  tokens: { "{{HARNESS_DIR}}": ".cursor" },
  files: [
    { from: "core/AGENTS.md", to: "AGENTS.md" },
    { from: "core/templates", to: ".cursor/templates" },
    { from: "core/skills", to: ".cursor/skills" },
    { from: "core/agents", to: ".cursor/agents", render: cursorAgent },
    { from: "core/hooks", to: ".cursor/hooks" },
    { from: "core/registry", to: ".cursor/registry" },
    {
      from: "harness/cursor/installation.json",
      to: ".cursor/registry/installation.json",
    },
    {
      from: "harness/cursor/hooks.json",
      to: ".cursor/registry/registration.json",
    },
    { from: "harness/cursor/hooks.json", to: ".cursor/hooks.json" },
  ],
};
