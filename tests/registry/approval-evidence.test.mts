import { test } from "node:test";
import {
  isAuditEvent,
  isHookResult,
} from "../../core/hooks/lib/validation.mjs";
import { syntheticApproval } from "../helpers/approval.mjs";
import { validator } from "../helpers/registry.mjs";

test("approval evidence wire contract and runtime agree on complete and malformed records", (t) => {
  const validate = validator("audit-event");
  const values = [] as { value: unknown; valid: boolean }[];
  for (const harness of ["claude", "codex"] as const) {
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
    ] as const) {
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

test("checkpoint evidence binds content and submission to the harness in both validators", (t) => {
  const validate = validator("audit-event");
  const sha256 = "a".repeat(64);
  const values: { value: unknown; valid: boolean }[] = [];
  for (const harness of ["claude", "codex"] as const) {
    const field = harness === "claude" ? "prompt_id" : "turn_id";
    const record = {
      id: "evt_checkpoint",
      v: 1,
      type: "checkpoint.confirmed",
      ts: "2026-09-29T00:00:00Z",
      actor: "human",
      harness,
      intent: "260929-plan",
      session: "s-1",
      checkpoint: "acceptance",
      content: { path: "intent.md", sha256 },
      submission: {
        hook_event_name: "UserPromptSubmit",
        field,
        id: "input-1",
        prompt_sha256: sha256,
      },
    };
    const { content: _c, submission: _s, ...legacy } = record;
    values.push(
      { value: record, valid: true },
      { value: legacy, valid: true },
      {
        value: {
          ...record,
          checkpoint: "design",
          content: { path: "design.md", sha256 },
        },
        valid: true,
      },
      {
        value: { ...record, checkpoint: "unit", unit: "U1" },
        valid: true,
      },
      {
        value: { ...record, checkpoint: "section", section: "plan" },
        valid: true,
      },
      {
        value: { ...record, checkpoint: "design" },
        valid: false,
      },
      {
        value: { ...record, content: { path: "design.md", sha256 } },
        valid: false,
      },
      {
        value: { ...record, content: { path: "../intent.md", sha256 } },
        valid: false,
      },
      {
        value: {
          ...record,
          content: { path: "intent.md", sha256: "A".repeat(64) },
        },
        valid: false,
      },
      {
        value: {
          ...record,
          content: { path: "intent.md", sha256: `${sha256}\n` },
        },
        valid: false,
      },
      {
        value: { ...record, content: { path: "intent.md", sha256, extra: 1 } },
        valid: false,
      },
      {
        value: {
          ...record,
          submission: {
            ...record.submission,
            field: harness === "claude" ? "turn_id" : "prompt_id",
          },
        },
        valid: false,
      },
      { value: { ...record, actor: "model" }, valid: false },
      { value: { ...record, checkpoint: "unit" }, valid: false },
    );
    for (const key of ["content", "submission", "session", "harness"]) {
      const edited = { ...record };
      Reflect.deleteProperty(edited, key);
      values.push({ value: edited, valid: false });
    }
  }
  t.plan(values.length * 2);
  for (const { value, valid } of values) {
    t.assert.equal(validate(value), valid, JSON.stringify(value));
    t.assert.equal(isAuditEvent(value), valid, JSON.stringify(value));
  }
});

test("hook results may ask io to apply approval only with a denial and a digest", (t) => {
  const validate = validator("hook-result");
  const approve = { sha256: "a".repeat(64) };
  const cases = [
    [{ decision: "deny", reason: "VOUCH-APPROVAL-APPLIED: x", approve }, true],
    [{ decision: "allow", approve }, false],
    [{ decision: "deny", reason: "x", approve: {} }, false],
    [
      { decision: "deny", reason: "x", approve: { sha256: "A".repeat(64) } },
      false,
    ],
    [
      { decision: "deny", reason: "x", approve: { ...approve, path: "../x" } },
      false,
    ],
  ];
  t.plan(cases.length * 2);
  for (const [value, valid] of cases) {
    t.assert.equal(validate(value), valid, JSON.stringify(value));
    t.assert.equal(isHookResult(value), valid, JSON.stringify(value));
  }
});
