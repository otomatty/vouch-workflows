import { reviewIntent } from "./lib/intent-review.mjs";
import { run } from "./lib/io.mjs";

/**
 * UserPromptSubmit: record explicit review, checkpoint and approval inputs. The draft becomes
 * approved only through io after the evidence is appended (docs/development/approval-boundary.md).
 * @type {import('./lib/contracts.mjs').HookMain}
 */
export async function main(input, ctx) {
  return reviewIntent(input, ctx);
}

run(main);
