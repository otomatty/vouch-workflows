import { guardBuild } from "./lib/build.mjs";
import { guardWrites } from "./lib/guard.mjs";
import { run } from "./lib/io.mjs";

/**
 * PreToolUse: refuse inspected tool writes to the audit, hook locks, the installed hook
 * registration and runtime, and approved artifacts; then hold implementation file edits until
 * the configured Intent has an approved plan with evidence. Never writes, records or trusts tool_input.
 * @type {import('./lib/contracts.mjs').HookMain}
 */
export async function main(input, ctx) {
  const guarded = await guardWrites(input, ctx, import.meta.url);
  return guarded.decision === "deny" ? guarded : guardBuild(input, ctx);
}

run(main);
