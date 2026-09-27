/** @satisfies {{files:{from:string,to:string}[]}} */
export default {
  files: [
    { from: "core/hooks", to: ".codex/hooks" },
    { from: "core/registry", to: ".codex/registry" },
    { from: "harness/codex/hooks.json", to: ".codex/hooks.json" },
    { from: "harness/codex/config.toml", to: ".codex/config.toml" },
  ],
};
