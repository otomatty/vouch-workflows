import { elapsedMilliseconds } from "./clock.mjs";
import { isAuditEvent } from "./validation.mjs";

/** @param {string} text @returns {string|null} */
function digest(text) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.toString("utf8") !== text) return null;
  // Loaded only for a digest, like clock.newId.
  return process
    .getBuiltinModule("node:crypto")
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
}

/** @type {import('./runtime-contracts.mjs').SnapshotIntent} */
export function snapshotIntent(text) {
  const header = /^---(\r?\n)status: (draft|approved)\1---\1/.exec(text);
  if (!header) return null;
  const [, newline, status] = header;
  const sha256 = digest(
    `---${newline}status: draft${newline}---${newline}${text.slice(header[0].length)}`,
  );
  if (sha256 === null) return null;
  return {
    status: /** @type {'draft'|'approved'} */ (status),
    revision: { path: "intent.md", sha256 },
  };
}

/** @type {import('./runtime-contracts.mjs').IdentifySubmission} */
export function identifySubmission(input, harness) {
  if (input.hook_event_name !== "UserPromptSubmit") return null;
  const field = harness === "claude" ? "prompt_id" : "turn_id";
  const id = input[field];
  if (!id) return null;
  const prompt_sha256 = digest(input.prompt);
  if (prompt_sha256 === null) return null;
  return { hook_event_name: "UserPromptSubmit", field, id, prompt_sha256 };
}

/** @type {import('./runtime-contracts.mjs').CompareIntentApprovalEvidence} */
export function compareIntentApprovalEvidence({
  gate,
  approval,
  input,
  harness,
  intent,
  text,
}) {
  if (
    !isAuditEvent(gate) ||
    gate.type !== "gate.opened" ||
    !isAuditEvent(approval) ||
    approval.type !== "intent.approved"
  )
    return { matches: false, reason: "invalid-record" };
  if (!gate.revision || !approval.revision || !approval.submission)
    return { matches: false, reason: "missing-evidence" };
  if (
    gate.intent !== intent ||
    approval.intent !== intent ||
    gate.harness !== harness ||
    approval.harness !== harness ||
    approval.session !== input.session_id
  )
    return { matches: false, reason: "scope" };
  if (approval.parent !== gate.id || approval.id === gate.id)
    return { matches: false, reason: "parent" };
  const snapshot = snapshotIntent(text);
  if (
    !snapshot ||
    gate.revision.sha256 !== snapshot.revision.sha256 ||
    approval.revision.sha256 !== snapshot.revision.sha256
  )
    return { matches: false, reason: "revision" };
  const submission = identifySubmission(input, harness);
  if (
    !submission ||
    submission.field !== approval.submission.field ||
    submission.id !== approval.submission.id ||
    submission.prompt_sha256 !== approval.submission.prompt_sha256
  )
    return { matches: false, reason: "submission" };
  const wait = elapsedMilliseconds(gate.ts, approval.ts);
  if (wait === null || wait !== approval.wait_ms)
    return { matches: false, reason: "wait" };
  return { matches: true };
}
