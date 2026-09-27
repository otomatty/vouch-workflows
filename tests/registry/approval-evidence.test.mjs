import { test } from "node:test";
import { isAuditEvent } from "../../core/hooks/lib/validation.mjs";
import { syntheticApproval } from "../helpers/approval.mjs";
import { validator } from "../helpers/registry.mjs";

test("approval evidence wire contract and runtime agree on complete and malformed records", (t) => {
  const validate = validator("audit-event");
  const values = /** @type {{value:unknown,valid:boolean}[]} */ ([]);
  for (const harness of /** @type {const} */ (["claude", "codex"])) {
    const { gate, approval } = syntheticApproval(harness);
    values.push({ value: gate, valid: true }, { value: approval, valid: true });
    for (const key of ["revision", "submission", "session", "harness"]) {
      const edited = { ...approval };
      Reflect.deleteProperty(edited, key);
      values.push({ value: edited, valid: false });
    }
    for (const key of ["session", "harness"]) {
      const edited = { ...gate };
      Reflect.deleteProperty(edited, key);
      values.push({ value: edited, valid: false });
    }
    for (const value of [
      { ...gate, source: "pr" },
      {
        ...approval,
        revision: {
          ...approval.revision,
          sha256: `${approval.revision.sha256}\n`,
        },
      },
      { ...gate, actor: "model" },
      { ...approval, actor: "model" },
      { ...approval, revision: { ...approval.revision, path: "../intent.md" } },
      {
        ...approval,
        revision: { ...approval.revision, sha256: "A".repeat(64) },
      },
      {
        ...approval,
        revision: { ...approval.revision, sha256: "a".repeat(63) },
      },
      {
        ...approval,
        revision: { ...approval.revision, sha256: "a".repeat(65) },
      },
      { ...approval, revision: { ...approval.revision, extra: true } },
      {
        ...approval,
        submission: {
          ...approval.submission,
          field: harness === "claude" ? "turn_id" : "prompt_id",
        },
      },
      { ...approval, submission: { ...approval.submission, id: "" } },
      {
        ...approval,
        submission: { ...approval.submission, hook_event_name: "PostToolUse" },
      },
      {
        ...approval,
        submission: { ...approval.submission, prompt_sha256: "not a hash" },
      },
      { ...approval, submission: { ...approval.submission, extra: true } },
    ])
      values.push({ value, valid: false });
    for (const [key, shape] of [
      ["revision", approval.revision],
      ["submission", approval.submission],
    ]) {
      for (const field of Object.keys(shape)) {
        const edited = { ...shape };
        Reflect.deleteProperty(edited, field);
        values.push({
          value: { ...approval, [String(key)]: edited },
          valid: false,
        });
      }
    }
    const oldGate = { ...gate };
    Reflect.deleteProperty(oldGate, "revision");
    const oldApproval = { ...approval };
    Reflect.deleteProperty(oldApproval, "revision");
    Reflect.deleteProperty(oldApproval, "submission");
    values.push(
      { value: oldGate, valid: true },
      { value: oldApproval, valid: true },
    );
  }
  t.plan(values.length * 2);
  for (const { value, valid } of values) {
    t.assert.equal(validate(value), valid, JSON.stringify(value));
    t.assert.equal(isAuditEvent(value), valid, JSON.stringify(value));
  }
});
