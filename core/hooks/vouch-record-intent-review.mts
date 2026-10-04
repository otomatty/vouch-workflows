import { recordAsk } from "./lib/aside.mjs";
import { reviewIntent } from "./lib/intent-review.mjs";
import { run } from "./lib/io.mjs";
import { checkKnowledge } from "./lib/knowledge-check.mjs";
import { approveMigration } from "./lib/migrate-approve.mjs";
import { answerQuestion } from "./lib/question.mjs";
/** UserPromptSubmit: explicit knowledge checks, asks, answers, migration approvals and review / checkpoint / approval inputs. Approval is applied by io only after durable evidence; asks, answers, migration approvals and knowledge checks never approve an Intent. */
export const main: import("./lib/contracts.mjs").HookMain = async (
  input,
  ctx,
) => {
  return (
    (await checkKnowledge(input, ctx)) ??
    (await recordAsk(input, ctx)) ??
    (await answerQuestion(input, ctx)) ??
    (await approveMigration(input, ctx)) ??
    reviewIntent(input, ctx)
  );
};
run(main);
