/** @satisfies {import('../../scripts/package.mjs').PackageManifest} */
export default {
  files: [
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
