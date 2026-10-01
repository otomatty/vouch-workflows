import { recordAsk } from "./lib/aside.mjs";
import { reviewIntent } from "./lib/intent-review.mjs";
import { run } from "./lib/io.mjs";
import { checkKnowledge } from "./lib/knowledge-check.mjs";
import { answerQuestion } from "./lib/question.mjs";
/** UserPromptSubmit: explicit knowledge checks, asks, answers and review / checkpoint / approval inputs.
 * Approval is applied by io only after durable evidence; asks, answers and knowledge checks never approve.
 * @type {import('./lib/contracts.mjs').HookMain} */
export async function main(input, ctx) {
  return (
    (await checkKnowledge(input, ctx)) ??
    (await recordAsk(input, ctx)) ??
    (await answerQuestion(input, ctx)) ??
    reviewIntent(input, ctx)
  );
}
run(main);
