import {
  compareIntentApprovalEvidence,
  identifySubmission,
  snapshotIntent,
} from "./lib/approval.mjs";
import { findEvent } from "./lib/audit.mjs";
import { elapsedMilliseconds } from "./lib/clock.mjs";
import { parseIntentReviewCommand } from "./lib/intent-review.mjs";
import { run } from "./lib/io.mjs";

/** Record explicit operator input only; status updates and authorization are separate.
 * @type {import('./lib/contracts.mjs').HookMain} */
export async function main(input, ctx) {
  if (input.hook_event_name !== "UserPromptSubmit" || !ctx.intent)
    return { decision: "allow" };
  const command = parseIntentReviewCommand(input.prompt);
  if (!command || command.kind === "confirm") return { decision: "allow" };
  if (command.kind === "invalid")
    return {
      decision: "deny",
      reason: "VOUCH-REVIEW-COMMAND: exact review or approval input required",
    };
  const submission = identifySubmission(input, ctx.harness);
  if (!submission)
    return {
      decision: "deny",
      reason:
        "VOUCH-REVIEW-IDENTITY: captured prompt or turn identity required",
    };
  const text = await ctx.readText(`vouch/intents/${ctx.intent}/intent.md`);
  const snapshot = text === null ? null : snapshotIntent(text);
  if (snapshot?.status !== "draft")
    return {
      decision: "deny",
      reason: "VOUCH-REVIEW-DRAFT: a supported draft artifact is required",
    };
  const id = ctx.newId(
    input.session_id,
    JSON.stringify([
      command.kind === "open" ? "gate.opened" : "intent.approved",
      ctx.harness,
      ctx.intent,
      submission.field,
      submission.id,
    ]),
  );
  const previous = await findEvent(ctx.audit, id);
  if (previous?.synthetic)
    return {
      decision: "deny",
      reason: "VOUCH-REVIEW-EVIDENCE: synthetic records cannot be reused",
    };
  const ts = previous?.ts ?? ctx.now();
  if (command.kind === "open")
    return {
      decision: "deny",
      reason: `VOUCH-REVIEW-RECORDED: ${id}; draft review opened; no status change`,
      events: [
        {
          id,
          v: 1,
          type: "gate.opened",
          ts,
          actor: "hook",
          harness: ctx.harness,
          intent: ctx.intent,
          session: input.session_id,
          source: "intent",
          revision: snapshot.revision,
        },
      ],
    };
  const gate = await findEvent(ctx.audit, command.gate);
  if (gate?.type !== "gate.opened" || gate.synthetic)
    return {
      decision: "deny",
      reason: "VOUCH-REVIEW-EVIDENCE: matching nonsynthetic gate required",
    };
  const wait = elapsedMilliseconds(gate.ts, ts);
  if (wait === null)
    return {
      decision: "deny",
      reason: "VOUCH-REVIEW-EVIDENCE: valid ordered UTC timestamps required",
    };
  const evidence =
    ctx.harness === "claude"
      ? {
          harness: /** @type {const} */ ("claude"),
          submission: {
            ...submission,
            field: /** @type {const} */ ("prompt_id"),
          },
        }
      : {
          harness: /** @type {const} */ ("codex"),
          submission: {
            ...submission,
            field: /** @type {const} */ ("turn_id"),
          },
        };
  /** @type {import('./lib/contracts.mjs').IntentApproved} */
  const approval = {
    id,
    v: 1,
    type: "intent.approved",
    ts,
    actor: "human",
    intent: ctx.intent,
    session: input.session_id,
    source: "intent",
    parent: command.gate,
    wait_ms: wait,
    revision: snapshot.revision,
    ...evidence,
  };
  const comparison = compareIntentApprovalEvidence({
    gate,
    approval,
    input,
    harness: ctx.harness,
    intent: ctx.intent,
    text: /** @type {string} */ (text),
  });
  if (!comparison.matches)
    return {
      decision: "deny",
      reason: `VOUCH-REVIEW-EVIDENCE: ${comparison.reason}`,
    };
  return {
    decision: "deny",
    reason: `VOUCH-APPROVAL-RECORDED: ${id}; evidence recorded; no status change or build authorization`,
    events: [approval],
  };
}

run(main);
