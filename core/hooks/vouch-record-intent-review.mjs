import { reviewIntent } from "./lib/intent-review.mjs";
import { run } from "./lib/io.mjs";
import { checkKnowledge } from "./lib/knowledge-check.mjs";
/** UserPromptSubmit: explicit knowledge checks and review / checkpoint / approval inputs.
 * Approval is applied by io only after durable evidence; knowledge checks never approve.
 * @type {import('./lib/contracts.mjs').HookMain} */
export async function main(input, ctx) {
  return (await checkKnowledge(input, ctx)) ?? reviewIntent(input, ctx);
}
run(main);
