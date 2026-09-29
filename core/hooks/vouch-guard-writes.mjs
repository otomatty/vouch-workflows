import { guardWrites } from "./lib/guard.mjs";
import { run } from "./lib/io.mjs";

/**
 * PreToolUse: refuse inspected tool writes to the audit, hook locks, the installed hook
 * registration and runtime, and approved artifacts. Never writes, records or trusts tool_input.
 * @type {import('./lib/contracts.mjs').HookMain}
 */
export async function main(input, ctx) {
  return guardWrites(input, ctx, import.meta.url);
}

run(main);
