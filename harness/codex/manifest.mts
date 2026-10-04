import codexAgent from "./agent-toml.mjs";

export default {
  tokens: { "{{HARNESS_DIR}}": ".codex" },
  files: [
    { from: "core/AGENTS.md", to: "AGENTS.md" },
    { from: "core/templates", to: ".codex/templates" },
    { from: "core/skills", to: ".agents/skills" },
    { from: "core/agents", to: ".codex/agents", render: codexAgent },
    {
      from: "harness/codex/installation.json",
      to: ".codex/registry/installation.json",
    },
    {
      from: "harness/codex/hooks.json",
      to: ".codex/registry/registration.json",
    },
    { from: "core/hooks", to: ".codex/hooks" },
    { from: "core/registry", to: ".codex/registry" },
    { from: "harness/codex/hooks.json", to: ".codex/hooks.json" },
    { from: "harness/codex/config.toml", to: ".codex/config.toml" },
  ],
};
