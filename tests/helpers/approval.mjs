import { createHash } from "node:crypto";
import { snapshotIntent } from "../../core/hooks/lib/approval.mjs";
import { newId } from "../../core/hooks/lib/clock.mjs";

// Authored examples only. No approval was captured from either harness.
/** @param {import('../../core/hooks/lib/contracts.mjs').Harness} [harness] */
export function syntheticApproval(harness = "claude") {
  const text = "---\nstatus: draft\n---\n# Intent\n\nAC-1: 日本語 💡\n";
  /** @type {import('../../core/hooks/lib/contracts.mjs').IntentRevision} */
  const revision = {
    path: "intent.md",
    sha256: "5259e13a692b20cac6b0feea5406237f5c122fa0f6458d30b98b15c7bb5505a4",
  };
  /** @type {import('../../core/hooks/lib/contracts.mjs').HookInput} */
  const input = {
    hook_event_name: "UserPromptSubmit",
    session_id: "synthetic-session",
    cwd: "/synthetic",
    prompt: "yes",
    prompt_id: "synthetic-prompt",
    turn_id: "synthetic-turn",
  };
  const submission = {
    hook_event_name: "UserPromptSubmit",
    field: harness === "claude" ? "prompt_id" : "turn_id",
    id: harness === "claude" ? "synthetic-prompt" : "synthetic-turn",
    prompt_sha256:
      "8a798890fe93817163b10b5f7bd2ca4d25d84c52739a645a889c173eee7d9d3d",
  };
  const gate = {
    id: "synthetic-gate",
    v: 1,
    type: "gate.opened",
    actor: "hook",
    intent: "synthetic-intent",
    source: "intent",
    session: "synthetic-session",
    ts: "2026-09-27T00:00:00Z",
    harness,
    revision,
    synthetic: true,
  };
  const approval = {
    ...gate,
    id: "synthetic-approval",
    type: "intent.approved",
    actor: "human",
    parent: gate.id,
    ts: "2026-09-27T00:00:01.050Z",
    wait_ms: 1050,
    submission,
  };
  return { gate, approval, input, harness, intent: "synthetic-intent", text };
}

/** @param {string} text */
const sha = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Hand-authored records shaped like the review hook's output, with derived identities.
 * Unit inputs only: they are not captured evidence of any approval.
 * @param {string} text Draft or approved intent.md.
 * @param {{harness?:import('../../core/hooks/lib/contracts.mjs').Harness,intent?:string,session?:string}} [options]
 */
export function evidenced(text, options = {}) {
  const {
    harness = "claude",
    intent = "260929-plan",
    session = "s-1",
  } = options;
  const revision = snapshotIntent(text)?.revision;
  if (!revision) throw new Error("unsupported synthetic text");
  const field = harness === "claude" ? "prompt_id" : "turn_id";
  /** @param {string} type @param {string} id */
  const derived = (type, id) =>
    newId(session, JSON.stringify([type, harness, intent, field, id]));
  /** @type {import('../../core/hooks/lib/contracts.mjs').GateOpened} */
  const gate = {
    id: derived("gate.opened", "open-1"),
    v: 1,
    type: "gate.opened",
    ts: "2026-09-29T00:00:00Z",
    actor: "hook",
    harness,
    intent,
    session,
    source: "intent",
    revision,
  };
  const approval =
    /** @type {import('../../core/hooks/lib/contracts.mjs').IntentApproved} */ ({
      id: derived("intent.approved", "approve-1"),
      v: 1,
      type: "intent.approved",
      ts: "2026-09-29T00:00:02Z",
      actor: "human",
      harness,
      intent,
      session,
      source: "intent",
      parent: gate.id,
      wait_ms: 2000,
      revision,
      submission: {
        hook_event_name: "UserPromptSubmit",
        field,
        id: "approve-1",
        prompt_sha256: sha(`vouch approve ${gate.id}`),
      },
    });
  return { gate, approval, derived };
}

/**
 * A hand-authored confirmation with a derived identity. Unit input only.
 * @param {import('../../core/hooks/lib/runtime-contracts.mjs').CheckpointTarget} target
 * @param {import('../../core/hooks/lib/contracts.mjs').CheckpointContent} content
 * @param {{harness?:import('../../core/hooks/lib/contracts.mjs').Harness,intent?:string,session?:string,id?:string}} [options]
 * @returns {import('../../core/hooks/lib/contracts.mjs').CheckpointConfirmed}
 */
export function confirmation(target, content, options = {}) {
  const {
    harness = "claude",
    intent = "260929-plan",
    session = "s-1",
    id = `confirm-${JSON.stringify(target)}`,
  } = options;
  const field = harness === "claude" ? "prompt_id" : "turn_id";
  return /** @type {import('../../core/hooks/lib/contracts.mjs').CheckpointConfirmed} */ ({
    id: newId(
      session,
      JSON.stringify(["checkpoint.confirmed", harness, intent, field, id]),
    ),
    v: 1,
    type: "checkpoint.confirmed",
    ts: "2026-09-29T00:00:01Z",
    actor: "human",
    harness,
    intent,
    session,
    ...target,
    content,
    submission: {
      hook_event_name: "UserPromptSubmit",
      field,
      id,
      prompt_sha256: sha("vouch confirm synthetic"),
    },
  });
}
