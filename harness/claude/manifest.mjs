/** @satisfies {{files:{from:string,to:string}[]}} */
export default {
  files: [
    { from: "core/hooks", to: ".claude/hooks" },
    { from: "core/registry", to: ".claude/registry" },
    { from: "harness/claude/settings.json", to: ".claude/settings.json" },
  ],
};
