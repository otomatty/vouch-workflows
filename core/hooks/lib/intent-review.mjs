import approvals from "../../registry/approval.json" with { type: "json" };
import commands from "../../registry/intent-review.json" with { type: "json" };
import {
  compareIntentApprovalEvidence,
  identifySubmission,
  snapshotIntent,
} from "./approval.mjs";
import { findEvent, listEvents } from "./audit.mjs";
import {
  checkpointContent,
  describeTarget,
  missingCheckpoints,
  readCheckpointMode,
  readPlan,
  requiredCheckpoints,
} from "./checkpoints.mjs";
import { elapsedMilliseconds } from "./clock.mjs";

const targets = new RegExp(commands.targetPattern);

/** @type {import('./runtime-contracts.mjs').ParseIntentReviewCommand} */
export function parseIntentReviewCommand(prompt) {
  if (prompt === commands.open) return { kind: "open" };
  if (prompt.startsWith(commands.approvePrefix)) {
    const gate = prompt.slice(commands.approvePrefix.length);
    return new RegExp(commands.gatePattern).test(gate)
      ? { kind: "approve", gate }
      : { kind: "invalid" };
  }
  if (prompt.startsWith(commands.confirmPrefix)) {
    const match = targets.exec(prompt.slice(commands.confirmPrefix.length));
    if (!match) return { kind: "invalid" };
    const [, topic, unit, section] = match;
    return {
      kind: "confirm",
      target: topic
        ? {
            checkpoint:
              /** @type {import('./runtime-contracts.mjs').TopicCheckpoint} */ (
                topic
              ),
          }
        : unit
          ? { checkpoint: "unit", unit }
          : { checkpoint: "section", section: `${section}` },
    };
  }
  const words = [
    commands.open,
    commands.approvePrefix.trimEnd(),
    commands.confirmPrefix.trimEnd(),
  ];
  return words.some(
    (word) =>
      prompt === word ||
      (prompt.startsWith(word) && /^\s/.test(prompt.slice(word.length))),
  )
    ? { kind: "invalid" }
    : null;
}

/** @param {string} reason @returns {import('./contracts.mjs').HookResult} */
const deny = (reason) => ({ decision: "deny", reason });

/**
 * Why the draft of `text` cannot be approved yet; null when every requirement holds.
 * @param {import('./contracts.mjs').ReadyHookContext} ctx @param {string} intent
 * @param {string} text @param {import('./contracts.mjs').AuditEvent[]} events
 */
async function blocked(ctx, intent, text, events) {
  const reading = readPlan(text);
  if ("error" in reading) return `plan ${reading.error}`;
  const mode = readCheckpointMode(await ctx.readText(approvals.rules));
  if (!mode)
    return `rules ${approvals.rules} must set one supported checkpoints mode`;
  const design = reading.plan.design
    ? await ctx.readText(`vouch/intents/${intent}/design.md`)
    : null;
  const missing = missingCheckpoints({
    required: requiredCheckpoints(mode, reading.plan),
    events,
    intent,
    texts: { intent: text, design },
    newId: ctx.newId,
  });
  return missing.length
    ? `checkpoints ${missing.map(describeTarget).join(", ")}`
    : null;
}

/** @type {import('./runtime-contracts.mjs').ReviewIntent} */
export async function reviewIntent(input, ctx) {
  const intent = ctx.intent;
  if (input.hook_event_name !== "UserPromptSubmit" || !intent)
    return { decision: "allow" };
  const command = parseIntentReviewCommand(input.prompt);
  if (!command) return { decision: "allow" };
  if (command.kind === "invalid")
    return deny(
      "VOUCH-REVIEW-COMMAND: exact review, confirm or approval input required",
    );
  const submission = identifySubmission(input, ctx.harness);
  if (!submission)
    return deny(
      "VOUCH-REVIEW-IDENTITY: captured prompt or turn identity required",
    );
  const text = await ctx.readText(`vouch/intents/${intent}/intent.md`);
  const snapshot = text === null ? null : snapshotIntent(text);
  if (text === null || snapshot?.status !== "draft")
    return deny("VOUCH-REVIEW-DRAFT: a supported draft artifact is required");
  const type =
    command.kind === "open"
      ? "gate.opened"
      : command.kind === "approve"
        ? "intent.approved"
        : "checkpoint.confirmed";
  const id = ctx.newId(
    input.session_id,
    JSON.stringify([
      type,
      ctx.harness,
      intent,
      submission.field,
      submission.id,
    ]),
  );
  const previous = await findEvent(ctx.audit, id);
  if (previous?.synthetic)
    return deny("VOUCH-REVIEW-EVIDENCE: synthetic records cannot be reused");
  const ts = previous?.ts ?? ctx.now();
  const { sha256 } = snapshot.revision;
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
          intent,
          session: input.session_id,
          source: "intent",
          revision: snapshot.revision,
        },
      ],
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
  if (command.kind === "confirm") {
    const target = command.target;
    const content = checkpointContent(target, {
      intent: text,
      design:
        target.checkpoint === "design"
          ? await ctx.readText(`vouch/intents/${intent}/design.md`)
          : null,
    });
    if (!content)
      return deny(
        `VOUCH-CHECKPOINT-TARGET: ${describeTarget(target)} is absent or not unique`,
      );
    /** @type {import('./contracts.mjs').CheckpointConfirmed} */
    const record = {
      id,
      v: 1,
      type: "checkpoint.confirmed",
      ts,
      actor: "human",
      ...evidence,
      intent,
      session: input.session_id,
      ...target,
      content,
    };
    // A confirmation never applies an approval; only the approval's own input does.
    return {
      decision: "deny",
      reason: `VOUCH-CHECKPOINT-RECORDED: ${id}; ${describeTarget(target)}`,
      events: [record],
    };
  }
  // The approval that applies is always this input's own record, matched against it.
  const events = await listEvents(ctx.audit);
  const gate = events.find((event) => event.id === command.gate);
  if (gate?.type !== "gate.opened" || gate.synthetic)
    return deny("VOUCH-REVIEW-EVIDENCE: matching nonsynthetic gate required");
  const wait = elapsedMilliseconds(gate.ts, ts);
  if (wait === null)
    return deny("VOUCH-REVIEW-EVIDENCE: valid ordered UTC timestamps required");
  // Field order matches the recorded goldens of the record-only contract.
  /** @type {import('./contracts.mjs').IntentApproved} */
  const approval = {
    id,
    v: 1,
    type: "intent.approved",
    ts,
    actor: "human",
    intent,
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
    intent,
    text,
  });
  if (!comparison.matches)
    return deny(`VOUCH-REVIEW-EVIDENCE: ${comparison.reason}`);
  const why = await blocked(ctx, intent, text, events);
  return {
    decision: "deny",
    reason:
      why === null
        ? `VOUCH-APPROVAL-APPLIED: ${approval.id}; intent.md approved at revision ${sha256.slice(0, 12)}`
        : `VOUCH-APPROVAL-RECORDED: ${approval.id}; not applied: ${why}`,
    events: [approval],
    ...(why === null ? { approve: { sha256 } } : {}),
  };
}
