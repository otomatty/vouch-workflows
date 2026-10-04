import operations from "../../registry/operations.json" with { type: "json" };
import { identifySubmission } from "./approval.mjs";
import { findEvent } from "./audit.mjs";
import { elapsedMilliseconds } from "./clock.mjs";

// Aside questions (docs/development/resume.md): the hook records; the model only answers.
const bounded = (text: string, limit: number) =>
  [...text].slice(0, limit).join("");

const askId = (
  newId: import("./runtime-contracts.mjs").NewId,
  harness: import("./contracts.mjs").Harness,
  intent: string,
  session: string,
  field: "prompt_id" | "turn_id",
  id: string,
) =>
  newId(session, JSON.stringify(["aside.asked", harness, intent, field, id]));

export const recordAsk: import("./runtime-contracts.mjs").PromptRecorder =
  async (input, ctx) => {
    if (input.hook_event_name !== "UserPromptSubmit") return null;
    const prefix = operations.ask.prefixes
      .map((value) => value.trimEnd())
      .find(
        (word) =>
          input.prompt === word ||
          (input.prompt.startsWith(word) &&
            /^\s/.test(input.prompt.slice(word.length))),
      );
    if (!prefix || !ctx.intent) return null;
    const question = input.prompt.slice(prefix.length).trim();
    if (!question)
      return {
        decision: "deny",
        reason: `VOUCH-ASK-COMMAND: \`${prefix} <question>\` needs a question`,
      };
    const submission = identifySubmission(input, ctx.harness);
    if (!submission)
      return {
        decision: "deny",
        reason: "VOUCH-ASK-IDENTITY: captured prompt or turn identity required",
      };
    const id = askId(
      ctx.newId,
      ctx.harness,
      ctx.intent,
      input.session_id,
      submission.field,
      submission.id,
    );
    const previous = await findEvent(ctx.audit, id);
    // Allowed, so the model answers in a separate read-only context (references/ask.md).
    return {
      decision: "allow",
      events: [
        {
          id,
          v: 1,
          type: "aside.asked",
          ts: previous?.ts ?? ctx.now(),
          actor: "human",
          harness: ctx.harness,
          intent: ctx.intent,
          session: input.session_id,
          question: bounded(question, operations.ask.questionChars),
        },
      ],
    };
  };

export const recordAsideAnswer: import("./runtime-contracts.mjs").RecordAsideAnswer =
  async (input, ctx) => {
    const field = ctx.harness === "claude" ? "prompt_id" : "turn_id";
    const turn = input[field];
    if (input.hook_event_name !== "Stop" || !ctx.intent || !turn)
      return { decision: "allow" };
    const asked = await findEvent(
      ctx.audit,
      askId(ctx.newId, ctx.harness, ctx.intent, input.session_id, field, turn),
    );
    if (asked?.type !== "aside.asked" || asked.synthetic)
      return { decision: "allow" };
    const id = ctx.newId(
      input.session_id,
      JSON.stringify(["aside.answered", asked.id]),
    );
    const ts = ctx.now();
    const duration = elapsedMilliseconds(asked.ts, ts);
    if ((await findEvent(ctx.audit, id)) || duration === null)
      return { decision: "allow" };
    const message = input.last_assistant_message;
    return {
      decision: "allow",
      events: [
        {
          id,
          v: 1,
          type: "aside.answered",
          ts,
          actor: "model",
          harness: ctx.harness,
          intent: ctx.intent,
          session: input.session_id,
          question: asked.question,
          parent: asked.id,
          duration_ms: duration,
          ...(message
            ? { answer: bounded(message, operations.ask.answerChars) }
            : {}),
        },
      ],
    };
  };
