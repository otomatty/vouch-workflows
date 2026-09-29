/** @typedef {import('../native-contracts.mjs').ApprovalStep} ApprovalStep */
/** @typedef {import('../native-contracts.mjs').ApprovalRun} ApprovalRun */

/** Runs in order; see docs/development/approval-boundary.md. */
const steps = /** @type {ApprovalStep[]} */ ([
  "write-before",
  "confirm-acceptance",
  "confirm-scope",
  "confirm-units",
  "review",
  "approve",
  "write-after",
]);
/** Reason IDs the hook reports for explicit inputs. @type {Partial<Record<ApprovalStep,string>>} */
const reasons = {
  "confirm-acceptance": "VOUCH-CHECKPOINT-RECORDED",
  "confirm-scope": "VOUCH-CHECKPOINT-RECORDED",
  "confirm-units": "VOUCH-CHECKPOINT-RECORDED",
  review: "VOUCH-REVIEW-RECORDED",
  approve: "VOUCH-APPROVAL-APPLIED",
};
const recorded = [
  "checkpoint.confirmed",
  "checkpoint.confirmed",
  "checkpoint.confirmed",
  "gate.opened",
  "intent.approved",
];

/** @returns {ApprovalStep[]} */
export function approvalSteps() {
  return [...steps];
}

/** The first Vouch reason ID in a tool result or CLI output. @param {string} text */
export function approvalReason(text) {
  return /VOUCH-[A-Z]+-[A-Z]+/.exec(text)?.[0] ?? null;
}

/** A scripted CLI run is not human consent or a model evaluation.
 * @param {ApprovalRun} run @returns {string[]} Failed expectation IDs. */
export function verifyApproval(run) {
  const errors = [];
  if (
    JSON.stringify(run.observations.map((item) => item.step)) !==
    JSON.stringify(steps)
  )
    errors.push("APPROVAL-STEPS");
  for (const item of run.observations) {
    const expected = reasons[item.step];
    if (item.step === "write-before" || item.step === "write-after") {
      const after = item.step === "write-after";
      if (
        item.reason !== (after ? null : "VOUCH-BUILD-UNAPPROVED") ||
        item.written !== after ||
        item.status !== (after ? "approved" : "draft")
      )
        errors.push(`${item.step}:APPROVAL-BUILD`);
      continue;
    }
    if (item.promptRequests !== 0)
      errors.push(`${item.step}:APPROVAL-PROVIDER`);
    if (item.status !== (item.step === "approve" ? "approved" : "draft"))
      errors.push(`${item.step}:APPROVAL-STATUS`);
    // Codex exec does not print hook reasons; a printed one must still match.
    if (
      item.reason !== expected &&
      (run.harness === "claude" || item.reason !== null)
    )
      errors.push(`${item.step}:APPROVAL-REASON`);
  }
  if (
    JSON.stringify(
      run.audit
        .filter((row) => row.type !== "session.started")
        .map((row) => row.type),
    ) !== JSON.stringify(recorded) ||
    run.audit.some((row) => row.harness !== run.harness || row.synthetic)
  )
    errors.push("APPROVAL-AUDIT");
  if (!run.revisionKept) errors.push("APPROVAL-REVISION");
  return errors;
}
