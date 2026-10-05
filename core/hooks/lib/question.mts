import operations from "../../registry/operations.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import { identifySubmission } from "./approval.mjs";
import { createIntentAuditStore, intentHome, listEvents } from "./audit.mjs";
import { elapsedMilliseconds, newId, now } from "./clock.mjs";
import { readQuestionCard } from "./decisions.mjs";
import { readArgs, readIntent } from "./env.mjs";

// Question lifecycle records (docs/development/resume.md). Answers, confirmations and approvals stay apart.
export type AuditEvent = import("./contracts.mjs").AuditEvent;
export type QuestionAsked = import("./contracts.mjs").QuestionAsked;

const report = (id: string, ok: boolean, detail: string) => ({
  v: 1 as const,
  ok,
  checks: [{ id, ok, detail }],
});

/** The derived identity of a question's single ask. */
const askedId = (intent: string, question: string) =>
  newId(intent, JSON.stringify(["question.asked", intent, question]));

/** @returns The nonsynthetic ask with the derived identity. */
function findAsked(
  events: AuditEvent[],
  intent: string,
  question: string,
): QuestionAsked | undefined {
  const id = askedId(intent, question);
  const event = events.find((item) => item.id === id);
  return event?.type === "question.asked" && !event.synthetic
    ? event
    : undefined;
}

const answerOf = (events: AuditEvent[], parent: string, except?: string) =>
  events.find(
    (item) =>
      item.type === "question.answered" &&
      !item.synthetic &&
      item.parent === parent &&
      item.id !== except,
  );

export const runQuestion: import("./runtime-contracts.mjs").RunQuestion =
  async (
    files,
    _environment,
    _git,
    ports = { intent: readIntent(), args: readArgs(), now },
  ) => {
    const { intent, args } = ports;
    if (!intent)
      return report("QUESTION-SCOPE", false, "VOUCH_INTENT names no Intent");
    const [operation = "", question = "", ...rest] = args;
    if (
      rest.length ||
      !operations.question.operations.includes(operation) ||
      !new RegExp(operations.question.pattern).test(question)
    )
      return report(
        "QUESTION-ARGS",
        false,
        `usage: ${operations.question.operations.join(" | ")} <Q-n>`,
      );
    const home = intentHome(intent);
    const audit = createIntentAuditStore(files, intent);
    const events = await listEvents(audit);
    const id = askedId(intent, question);
    if (operation === "ask") {
      const previous = events.find((item) => item.id === id);
      if (previous?.synthetic)
        return report(
          "QUESTION-EVIDENCE",
          false,
          `${id}: synthetic records cannot be reused`,
        );
      const card = readQuestionCard(
        await files.readText(`${home}/${documents.decisions}`),
        question,
      );
      if ("error" in card) return report("QUESTION-CARD", false, card.error);
      const event: QuestionAsked = {
        id,
        v: 1,
        type: "question.asked",
        ts: previous?.ts ?? ports.now(),
        actor: "model",
        intent,
        question,
        options: card.options.length,
        card: { path: "decisions.md", sha256: card.sha256 },
        ...(card.default
          ? { blocking: false, default: card.default }
          : { blocking: true }),
      };
      const same = (item: AuditEvent) =>
        item.type === "question.asked" &&
        JSON.stringify([
          item.options,
          item.blocking,
          item.default,
          item.card,
        ]) ===
          JSON.stringify([
            event.options,
            event.blocking,
            event.default,
            event.card,
          ]);
      if (previous && !same(previous))
        return report(
          "QUESTION-CONFLICT",
          false,
          `${question} was asked as ${id} with another card; ask the changed question as a new Q-n`,
        );
      await audit.append([event]);
      return report("QUESTION-RECORDED", true, `question.asked ${id}`);
    }
    const asked = findAsked(events, intent, question);
    if (!asked)
      return report(
        "QUESTION-UNASKED",
        false,
        `${question}: no question.asked ${id}`,
      );
    const answer = answerOf(events, asked.id);
    if (answer)
      return report(
        "QUESTION-ANSWERED",
        false,
        `${question}: answered by a person in ${answer.id}`,
      );
    if (!asked.default)
      return report(
        "QUESTION-BLOCKING",
        false,
        `${question}: blocking without an executable default; a person must answer`,
      );
    const defaultId = newId(
      intent,
      JSON.stringify(["question.defaulted", intent, asked.id]),
    );
    const earlier = events.find((item) => item.id === defaultId);
    const ts = earlier?.ts ?? ports.now();
    const wait = elapsedMilliseconds(asked.ts, ts);
    if (wait === null)
      return report(
        "QUESTION-EVIDENCE",
        false,
        `${question}: unordered timestamps`,
      );
    await audit.append([
      {
        id: defaultId,
        v: 1,
        type: "question.defaulted",
        ts,
        actor: "model",
        intent,
        question,
        choice: asked.default,
        parent: asked.id,
        wait_ms: wait,
      },
    ]);
    return report("QUESTION-RECORDED", true, `question.defaulted ${defaultId}`);
  };

const deny = (reason: string): import("./contracts.mjs").HookResult => ({
  decision: "deny",
  reason,
});

export const answerQuestion: import("./runtime-contracts.mjs").PromptRecorder =
  async (input, ctx) => {
    if (input.hook_event_name !== "UserPromptSubmit") return null;
    const word = operations.answer.prefix.trimEnd();
    const { prompt } = input;
    if (
      prompt !== word &&
      !(prompt.startsWith(word) && /^\s/.test(prompt.slice(word.length)))
    )
      return null;
    const intent = ctx.intent;
    if (!intent) return null;
    const match = new RegExp(operations.answer.pattern).exec(
      prompt.slice(operations.answer.prefix.length),
    );
    if (!prompt.startsWith(operations.answer.prefix) || !match)
      return deny(
        "VOUCH-ANSWER-COMMAND: exact `vouch answer <Q-n> <option>` input required",
      );
    const [, question = "", choice = ""] = match;
    const submission = identifySubmission(input, ctx.harness);
    if (!submission)
      return deny(
        "VOUCH-ANSWER-IDENTITY: captured prompt or turn identity required",
      );
    const events = await listEvents(ctx.audit);
    const asked = findAsked(events, intent, question);
    if (!asked)
      return deny(
        `VOUCH-ANSWER-QUESTION: ${question} has no recorded question.asked`,
      );
    const card = readQuestionCard(
      await ctx.readText(`${intentHome(intent)}/${documents.decisions}`),
      question,
    );
    if (!("error" in card) && card.sha256 !== asked.card?.sha256)
      return deny(
        `VOUCH-ANSWER-CHANGED: ${question} changed after ${asked.id}; it must be asked again as a new Q-n`,
      );
    if ("error" in card || !card.options.includes(choice))
      return deny(
        `VOUCH-ANSWER-CHOICE: ${choice} is not an option of ${question}`,
      );
    // One answer per question: a concurrent different answer conflicts in the store under its lock.
    const id = ctx.newId(
      intent,
      JSON.stringify(["question.answered", intent, asked.id]),
    );
    const previous = events.find((item) => item.id === id);
    const answered =
      answerOf(events, asked.id, id) ??
      (previous &&
      (previous.type !== "question.answered" ||
        previous.choice !== choice ||
        previous.session !== input.session_id ||
        previous.harness !== ctx.harness)
        ? previous
        : undefined);
    if (answered)
      return deny(
        `VOUCH-ANSWER-EXISTS: ${question} was answered in ${answered.id}; ask a changed question as a new Q-n`,
      );
    const ts = previous?.ts ?? ctx.now();
    const wait = elapsedMilliseconds(asked.ts, ts);
    if (wait === null)
      return deny(
        "VOUCH-ANSWER-EVIDENCE: valid ordered UTC timestamps required",
      );
    // Recorded and not forwarded, like confirmations: an answer never confirms or approves.
    return {
      decision: "deny",
      reason: `VOUCH-ANSWER-RECORDED: ${id}; ${question} = ${choice}; not a checkpoint confirmation or approval`,
      events: [
        {
          id,
          v: 1,
          type: "question.answered",
          ts,
          actor: "human",
          harness: ctx.harness,
          intent,
          session: input.session_id,
          question,
          choice,
          parent: asked.id,
          wait_ms: wait,
        },
      ],
    };
  };
