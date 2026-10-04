import { guardBuild } from "./lib/build.mjs";
import { guardGit } from "./lib/git-guard.mjs";
import { guardWrites } from "./lib/guard.mjs";
import { run } from "./lib/io.mjs";

/** PreToolUse: refuse inspected tool writes to the audit, hook locks, the installed hook registration and runtime, and approved artifacts; hold implementation file edits until the configured Intent has an approved plan with evidence; then refuse shell pushes to a protected branch and commits out of the contract, test and implementation order (docs/development/git-guard.md). Never writes, records or trusts tool_input. */
export const main: import("./lib/contracts.mjs").HookMain = async (
  input,
  ctx,
) => {
  const guarded = await guardWrites(input, ctx, import.meta.url);
  if (guarded.decision === "deny") return guarded;
  const built = await guardBuild(input, ctx);
  return built.decision === "deny" ? built : guardGit(input, ctx);
};

run(main);
