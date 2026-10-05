import { elapsedMilliseconds, sha256Hex } from "./clock.mjs";
import { isAuditEvent } from "./validation.mjs";

function digest(text: string): string | null {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.toString("utf8") !== text) return null;
  return sha256Hex(bytes);
}

export const snapshotIntent: import("./runtime-contracts.mjs").SnapshotIntent =
  (text) => {
    const draft = draftText(text);
    if (!draft) return null;
    const sha256 = digest(draft.text);
    if (sha256 === null) return null;
    return {
      status: draft.status,
      revision: { path: "intent.md", sha256 },
    };
  };

export const draftText: import("./runtime-contracts.mjs").DraftText = (
  text,
) => {
  const header = /^---(\r?\n)status: (draft|approved)\1---\1/.exec(text);
  if (!header) return null;
  const [, newline, status] = header;
  return {
    status: status as "draft" | "approved",
    text: `---${newline}status: draft${newline}---${newline}${text.slice(header[0].length)}`,
  };
};

export const identifySubmission: import("./runtime-contracts.mjs").IdentifySubmission =
  (input, harness) => {
    if (input.hook_event_name !== "UserPromptSubmit") return null;
    const field = harness === "claude" ? "prompt_id" : "turn_id";
    const id = input[field];
    if (!id) return null;
    const prompt_sha256 = digest(input.prompt);
    if (prompt_sha256 === null) return null;
    return { hook_event_name: "UserPromptSubmit", field, id, prompt_sha256 };
  };

export const compareIntentApprovalEvidence: import("./runtime-contracts.mjs").CompareIntentApprovalEvidence =
  ({ gate, approval, input, harness, intent, text }) => {
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
  };

export const approvedText: import("./runtime-contracts.mjs").ApprovedText = (
  text,
  sha256,
) => {
  const snapshot = snapshotIntent(text);
  if (snapshot?.revision.sha256 !== sha256) return null;
  return text.replace(/^(---\r?\nstatus: )draft/, "$1approved");
};

export const findApproval: import("./runtime-contracts.mjs").FindApproval = ({
  text,
  events,
  intent,
  newId,
}) => {
  const sha256 = snapshotIntent(text)?.revision.sha256;
  const gates = new Map(events.map((event) => [event.id, event]));
  for (const approval of events) {
    if (
      approval.type !== "intent.approved" ||
      approval.synthetic ||
      approval.intent !== intent ||
      !approval.submission ||
      approval.revision.sha256 !== sha256 ||
      approval.id !==
        newId(
          approval.session,
          JSON.stringify([
            approval.type,
            approval.harness,
            intent,
            approval.submission.field,
            approval.submission.id,
          ]),
        )
    )
      continue;
    const gate = gates.get(approval.parent);
    if (
      gate?.type === "gate.opened" &&
      !gate.synthetic &&
      gate.id !== approval.id &&
      gate.intent === intent &&
      gate.harness === approval.harness &&
      gate.revision?.sha256 === sha256 &&
      elapsedMilliseconds(gate.ts, approval.ts) === approval.wait_ms
    )
      return approval;
  }
  return null;
};
