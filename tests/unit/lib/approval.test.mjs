import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  approvedText,
  compareIntentApprovalEvidence,
  findApproval,
  identifySubmission,
  snapshotIntent,
} from "../../../core/hooks/lib/approval.mjs";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import { parseInput } from "../../../core/hooks/lib/validation.mjs";
import { evidenced, syntheticApproval } from "../../helpers/approval.mjs";
import { planned } from "../../helpers/intent-review.mjs";
import { capturedPrompt } from "../../helpers/runtime.mjs";

test("snapshot hashes UTF-8 bytes with only the status value normalized", (t) => {
  const { text, gate } = syntheticApproval();
  const approved = text.replace("status: draft", "status: approved");
  const crlf = text.replaceAll("\n", "\r\n");
  t.plan(6);
  t.assert.deepEqual(snapshotIntent(text), {
    status: "draft",
    revision: gate.revision,
  });
  t.assert.deepEqual(snapshotIntent(approved), {
    status: "approved",
    revision: gate.revision,
  });
  t.assert.deepEqual(snapshotIntent(crlf), {
    status: "draft",
    revision: {
      path: "intent.md",
      sha256: createHash("sha256").update(crlf).digest("hex"),
    },
  });
  t.assert.deepEqual(
    snapshotIntent(crlf.replace("status: draft", "status: approved"))?.revision,
    snapshotIntent(crlf)?.revision,
  );
  t.assert.notDeepEqual(snapshotIntent(`${text} `)?.revision, gate.revision);
  t.assert.notDeepEqual(
    snapshotIntent(text.replace("AC-1", "AC-2"))?.revision,
    gate.revision,
  );
});

test("ambiguous or unsupported frontmatter and malformed Unicode have no snapshot", (t) => {
  const cases = [
    "",
    "status: draft\n",
    "---\nstatus: draft\n---",
    "\uFEFF---\nstatus: draft\n---\n",
    "---\nstatus: draft\nstatus: approved\n---\n",
    "---\nstatus: draft\nextra: yes\n---\n",
    "---\nstatus: other\n---\n",
    "---\r\nstatus: draft\n---\n",
    "---\nstatus: draft\n---\r\n",
    "---\nstatus: draft \n---\n",
    "---\nstatus: draft\n---\n\ud800",
    "---\nstatus: draft\n---\n\udc00",
  ];
  t.plan(cases.length);
  for (const text of cases)
    t.assert.equal(snapshotIntent(text), null, JSON.stringify(text));
});

test("real captured inputs preserve identity without treating the capture prompt as consent", (t) => {
  const harnesses = /** @type {const} */ (["claude", "codex"]);
  t.plan(harnesses.length * 4);
  for (const harness of harnesses) {
    const fixture = capturedPrompt(harness);
    const input = parseInput(JSON.stringify(fixture.payload));
    const field = harness === "claude" ? "prompt_id" : "turn_id";
    t.assert.equal(fixture.synthetic, false);
    t.assert.equal(input?.[field], fixture.payload[field]);
    t.assert.equal(input !== null, true);
    if (input?.hook_event_name !== "UserPromptSubmit")
      throw new Error("fixture shape");
    t.assert.deepEqual(identifySubmission(input, harness), {
      hook_event_name: "UserPromptSubmit",
      field,
      id: fixture.payload[field],
      prompt_sha256: createHash("sha256").update(input.prompt).digest("hex"),
    });
  }
});

test("submission identity does not fall back or interpret natural-language consent", (t) => {
  const { input } = syntheticApproval();
  const cases = [
    { input: { ...input, prompt_id: undefined }, harness: "claude" },
    { input: { ...input, turn_id: undefined }, harness: "codex" },
    { input: { ...input, prompt_id: "" }, harness: "claude" },
    { input: { ...input, turn_id: "" }, harness: "codex" },
    { input: { ...input, prompt: "\ud800" }, harness: "claude" },
    {
      input: { ...input, hook_event_name: "SessionStart", source: "startup" },
      harness: "claude",
    },
  ];
  t.plan(cases.length + 2);
  for (const value of cases)
    t.assert.equal(
      identifySubmission(
        /** @type {never} */ (value.input),
        /** @type {never} */ (value.harness),
      ),
      null,
    );
  t.assert.notEqual(
    identifySubmission({ ...input, prompt: "no" }, "claude"),
    null,
  );
  t.assert.notDeepEqual(
    identifySubmission({ ...input, prompt: "yes " }, "claude"),
    identifySubmission(input, "claude"),
  );
});

test("synthetic evidence can match; a match never authenticates or writes approval", (t) => {
  t.plan(6);
  for (const harness of /** @type {const} */ (["claude", "codex"])) {
    const value = syntheticApproval(harness);
    const before = structuredClone(value);
    t.assert.deepEqual(compareIntentApprovalEvidence(value), { matches: true });
    t.assert.deepEqual(
      compareIntentApprovalEvidence({
        ...value,
        text: value.text.replace("status: draft", "status: approved"),
        gate: { ...value.gate, session: "earlier-session" },
      }),
      { matches: true },
    );
    t.assert.deepEqual(value, before);
  }
});

test("comparison distinguishes malformed and historical evidence", (t) => {
  const value = syntheticApproval();
  const { revision: _revision, ...oldGate } = value.gate;
  const {
    revision: _approvedRevision,
    submission: _submission,
    ...oldApproval
  } = value.approval;
  const cases = [
    { value: { ...value, gate: null }, reason: "invalid-record" },
    { value: { ...value, approval: null }, reason: "invalid-record" },
    { value: { ...value, gate: oldApproval }, reason: "invalid-record" },
    { value: { ...value, approval: oldGate }, reason: "invalid-record" },
    { value: { ...value, gate: oldGate }, reason: "missing-evidence" },
    { value: { ...value, approval: oldApproval }, reason: "missing-evidence" },
  ];
  t.plan(cases.length);
  for (const item of cases)
    t.assert.deepEqual(compareIntentApprovalEvidence(item.value), {
      matches: false,
      reason: item.reason,
    });
});

test("scope parent document input and wait mismatches cannot be reused as matching evidence", (t) => {
  const value = syntheticApproval();
  const { gate, approval, input, text } = value;
  const cases = [
    { value: { ...value, intent: "other" }, reason: "scope" },
    {
      value: { ...value, gate: { ...gate, intent: "other" } },
      reason: "scope",
    },
    {
      value: {
        ...value,
        approval: {
          ...approval,
          harness: "codex",
          submission: { ...approval.submission, field: "turn_id" },
        },
      },
      reason: "scope",
    },
    {
      value: { ...value, approval: { ...approval, intent: "other" } },
      reason: "scope",
    },
    {
      value: { ...value, gate: { ...gate, harness: "codex" } },
      reason: "scope",
    },
    { value: { ...value, harness: "codex" }, reason: "scope" },
    {
      value: { ...value, approval: { ...approval, session: "other" } },
      reason: "scope",
    },
    {
      value: { ...value, approval: { ...approval, parent: "other" } },
      reason: "parent",
    },
    {
      value: { ...value, approval: { ...approval, id: gate.id } },
      reason: "parent",
    },
    { value: { ...value, text: "invalid" }, reason: "revision" },
    { value: { ...value, text: `${text}changed` }, reason: "revision" },
    {
      value: {
        ...value,
        gate: {
          ...gate,
          revision: { ...gate.revision, sha256: "0".repeat(64) },
        },
      },
      reason: "revision",
    },
    {
      value: {
        ...value,
        approval: {
          ...approval,
          revision: { ...gate.revision, sha256: "0".repeat(64) },
        },
      },
      reason: "revision",
    },
    {
      value: { ...value, input: { ...input, prompt_id: "other" } },
      reason: "submission",
    },
    {
      value: { ...value, input: { ...input, prompt_id: "" } },
      reason: "submission",
    },
    {
      value: { ...value, input: { ...input, prompt: "not yes" } },
      reason: "submission",
    },
    {
      value: { ...value, approval: { ...approval, wait_ms: 0 } },
      reason: "wait",
    },
    {
      value: {
        ...value,
        gate: { ...gate, ts: approval.ts },
        approval: { ...approval, ts: gate.ts },
      },
      reason: "wait",
    },
    {
      value: { ...value, gate: { ...gate, ts: "2026-02-30T00:00:00Z" } },
      reason: "wait",
    },
  ];
  t.plan(cases.length + 1);
  for (const item of cases)
    t.assert.deepEqual(
      compareIntentApprovalEvidence(
        /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').ApprovalComparisonInput} */ (
          item.value
        ),
      ),
      { matches: false, reason: item.reason },
    );
  t.assert.deepEqual(
    compareIntentApprovalEvidence({
      ...value,
      approval: { ...approval, ts: gate.ts, wait_ms: 0 },
    }),
    { matches: true },
  );
});

test("approved text changes only the status value of a draft of that revision", (t) => {
  const text = planned();
  const crlf = text.replaceAll("\n", "\r\n");
  const sha256 = /** @type {string} */ (snapshotIntent(text)?.revision.sha256);
  const approved = text.replace("status: draft", "status: approved");
  t.plan(8);
  t.assert.equal(approvedText(text, sha256), approved);
  t.assert.equal(approvedText(approved, sha256), approved);
  t.assert.deepEqual(
    snapshotIntent(/** @type {string} */ (approvedText(text, sha256))),
    { status: "approved", revision: snapshotIntent(text)?.revision },
  );
  const crlfSha = /** @type {string} */ (snapshotIntent(crlf)?.revision.sha256);
  t.assert.equal(
    approvedText(crlf, crlfSha),
    crlf.replace("status: draft", "status: approved"),
  );
  t.assert.equal(approvedText(crlf, sha256), null);
  t.assert.equal(approvedText(`${text}changed`, sha256), null);
  t.assert.equal(approvedText("# no frontmatter", sha256), null);
  t.assert.equal(approvedText(text, "0".repeat(64)), null);
});

test("an approval counts only with derived identity, its own gate and matching revision", (t) => {
  const text = planned();
  const intent = "260929-plan";
  const { gate, approval } = evidenced(text, { intent });
  const approved = text.replace("status: draft", "status: approved");
  /** @param {unknown[]} events @param {string} [current] */
  const find = (events, current = text) =>
    findApproval({
      text: current,
      events: /** @type {never} */ (events),
      intent,
      newId,
    });
  const { revision: _r, submission: _s, ...legacy } = approval;
  const other = evidenced(`${text}later\n`, { intent });
  const variants = [
    [{ ...gate, synthetic: true }, approval],
    [gate, { ...approval, synthetic: true }],
    [approval],
    [{ ...gate, intent: "other" }, approval],
    [gate, { ...approval, intent: "other" }],
    [{ ...gate, harness: "codex" }, approval],
    [{ ...gate, revision: other.gate.revision }, approval],
    [gate, { ...approval, revision: other.approval.revision }],
    [gate, { ...approval, id: "evt_forged" }],
    [gate, { ...approval, session: "rebound" }],
    [
      gate,
      { ...approval, submission: { ...approval.submission, id: "rebound" } },
    ],
    [gate, { ...approval, wait_ms: 1 }],
    [gate, { ...approval, ts: "2026-02-30T00:00:00Z" }],
    [{ ...gate, type: "gate.approved" }, approval],
    [
      { ...gate, id: approval.id },
      { ...approval, parent: approval.id },
    ],
    [
      { ...approval, parent: approval.id },
      { ...gate, id: approval.id },
    ],
    [{ ...gate, revision: undefined }, approval],
    [gate, legacy],
    [gate, { ...approval, type: "question.defaulted" }],
  ];
  t.plan(variants.length + 6);
  t.assert.deepEqual(find([gate, approval]), approval);
  t.assert.deepEqual(find([approval, gate], approved), approval);
  t.assert.deepEqual(
    find([gate, { ...approval, synthetic: true }, approval]),
    approval,
  );
  t.assert.equal(find([gate, approval], `${text}later\n`), null);
  t.assert.equal(find([gate, approval], "# unsupported"), null);
  t.assert.deepEqual(
    findApproval({
      text,
      events: [other.gate, other.approval, gate, approval],
      intent,
      newId,
    }),
    approval,
  );
  for (const events of variants)
    t.assert.equal(find(events), null, JSON.stringify(events.at(-1)));
});
