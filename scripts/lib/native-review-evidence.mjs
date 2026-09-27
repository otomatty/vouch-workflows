import { createHash } from "node:crypto";
import { snapshotIntent } from "../../core/hooks/lib/approval.mjs";
import { elapsedMilliseconds } from "../../core/hooks/lib/clock.mjs";
import { isAuditEvent } from "../../core/hooks/lib/validation.mjs";
import commands from "../../core/registry/intent-review.json" with {
  type: "json",
};

/** Observed emission is not proof of human consent or a model evaluation.
 * @param {{events:unknown[],providerRequests:number,expectedDraft:string,actualDraft:string,distributionUnchanged:boolean}} observation
 * @returns {string[]} Failed check IDs; an empty array means this observation passes.
 */
export function verifyNativeReview(observation) {
  const errors = [];
  if (observation.providerRequests !== 0) errors.push("NATIVE-PROVIDER");
  if (observation.expectedDraft !== observation.actualDraft)
    errors.push("NATIVE-DRAFT");
  if (!observation.distributionUnchanged) errors.push("NATIVE-DISTRIBUTION");
  const rows = observation.events.filter(isAuditEvent);
  const gate = rows.find((row) => row.type === "gate.opened");
  const approval = rows.find((row) => row.type === "intent.approved");
  const starts = rows.filter((row) => row.type === "session.started");
  if (
    rows.length !== 4 ||
    observation.events.length !== 4 ||
    !gate ||
    !approval ||
    starts.length !== 2 ||
    rows.some((row) => row.synthetic || row.harness !== "codex") ||
    new Set(rows.map((row) => row.id)).size !== 4 ||
    !starts.some((row) => row.session === gate.session) ||
    !starts.some((row) => row.session === approval.session)
  ) {
    errors.push("NATIVE-EVENTS");
    return errors;
  }
  const snapshot = snapshotIntent(observation.expectedDraft);
  const promptHash = createHash("sha256")
    .update(`${commands.approvePrefix}${gate.id}`)
    .digest("hex");
  if (
    snapshot?.status !== "draft" ||
    gate.source !== "intent" ||
    approval.source !== "intent" ||
    approval.parent !== gate.id ||
    gate.session === approval.session ||
    rows.some((row) => row.intent !== gate.intent) ||
    gate.revision?.sha256 !== snapshot.revision.sha256 ||
    approval.revision?.sha256 !== snapshot.revision.sha256 ||
    gate.revision?.path !== "intent.md" ||
    approval.revision?.path !== "intent.md" ||
    approval.wait_ms !== elapsedMilliseconds(gate.ts, approval.ts) ||
    approval.submission?.field !== "turn_id" ||
    approval.submission.prompt_sha256 !== promptHash
  )
    errors.push("NATIVE-RELATION");
  return errors;
}
