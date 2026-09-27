/** @satisfies {import('../../scripts/package.mjs').PackageManifest} */
export default {
  tokens: { "{{HARNESS_DIR}}": ".claude" },
  files: [
    { from: "core/skills", to: ".claude/skills" },
    {
      from: "harness/claude/installation.json",
      to: ".claude/registry/installation.json",
    },
    {
      from: "harness/claude/settings.json",
      to: ".claude/registry/registration.json",
    },
    { from: "core/hooks", to: ".claude/hooks" },
    { from: "core/registry", to: ".claude/registry" },
    { from: "harness/claude/settings.json", to: ".claude/settings.json" },
  ],
};
