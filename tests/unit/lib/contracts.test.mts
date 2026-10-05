import { test } from "node:test";
import { validator } from "../../helpers/registry.mjs";

// Compile once per file; every case still validates its own value.
const validateAudit = validator("audit-event");
const validateResult = validator("hook-result");
const validateProcess = validator("hook-process");

export type HookMain = import("../../../core/hooks/lib/contracts.mjs").HookMain;
export type AuditEvent =
  import("../../../core/hooks/lib/contracts.mjs").AuditEvent;
export type HookResult =
  import("../../../core/hooks/lib/contracts.mjs").HookResult;
export type HookProcessResult =
  import("../../../core/hooks/lib/contracts.mjs").HookProcessResult;

test("JSDoc valid examples also satisfy the corresponding wire schemas", (t) => {
  const audit: AuditEvent = {
    id: "test",
    v: 1,
    type: "hook.check",
    ts: "2026-09-27T00:00:00Z",
    actor: "hook",
    check: "citation",
    result: "pass",
    duration_ms: 0,
    synthetic: true,
  };
  const result: HookResult = { decision: "allow", events: [audit] };
  const processResult: HookProcessResult = {
    exitCode: 0,
    stdout: null,
    stderr: "",
  };
  t.plan(3);
  t.assert.equal(validateAudit(audit), true, "HOOK-11: typed audit");
  t.assert.equal(validateResult(result), true, "HOOK-11: typed result");
  t.assert.equal(
    validateProcess(processResult),
    true,
    "HOOK-11: typed process",
  );
});

test("JSDoc rejects impossible decision and audit discriminants", (t) => {
  // These directives fail typecheck if the corresponding contract becomes permissive.
  // @ts-expect-error Denial requires a reason.
  const noReason: HookResult = { decision: "deny" };
  // @ts-expect-error Only zero and two are permitted.
  const badExit: HookProcessResult = { exitCode: 1, stdout: null, stderr: "" };
  const badType: AuditEvent = {
    id: "test",
    v: 1,
    ts: "2026-09-27T00:00:00Z",
    actor: "hook",
    // @ts-expect-error Unknown audit type.
    type: "unknown.event",
  };
  // @ts-expect-error Codex cannot report Claude token usage.
  const badTokens: AuditEvent = {
    id: "test",
    v: 1,
    ts: "2026-09-27T00:00:00Z",
    actor: "hook",
    type: "session.started",
    session: "s",
    harness: "codex",
    tokens: { in: 1, out: 2 },
  };
  // @ts-expect-error HookMain must return a decision.
  const badMain: HookMain = () => ({ exitCode: 0 });
  t.plan(5);
  t.assert.equal(validateResult(noReason), false, "HOOK-11");
  t.assert.equal(validateProcess(badExit), false, "HOOK-11");
  t.assert.equal(validateAudit(badType), false, "HOOK-11");
  t.assert.equal(validateAudit(badTokens), false, "HOOK-11");
  t.assert.equal(
    validateResult(
      badMain(
        {
          session_id: "s",
          cwd: "/test",
          hook_event_name: "SessionStart",
          source: "startup",
        },
        {
          projectRoot: "/test",
          harness: "codex",
          generation: "test",
          now: () => "2026-09-27T00:00:00Z",
          newId: () => "test",
          readText: async () => null,
          locate: async () => ({
            inside: null,
            contains: false,
            canonical: "/outside",
            kind: "missing",
            links: 0,
          }),
        },
      ),
    ),
    false,
    "HOOK-11",
  );
});

test("typed approval evidence binds complete metadata to its harness", (t) => {
  const evidence: import("../../../core/hooks/lib/contracts.mjs").IntentApprovalEvidence =
    {
      harness: "claude",
      session: "synthetic-session",
      revision: { path: "intent.md", sha256: "a".repeat(64) },
      submission: {
        hook_event_name: "UserPromptSubmit",
        field: "prompt_id",
        id: "synthetic-prompt",
        prompt_sha256: "b".repeat(64),
      },
    };
  // @ts-expect-error Codex evidence cannot use the Claude input identity field.
  const mismatched: import("../../../core/hooks/lib/contracts.mjs").IntentApprovalEvidence =
    { ...evidence, harness: "codex" };
  // @ts-expect-error Revision requires submission, session and harness together.
  const incomplete: import("../../../core/hooks/lib/contracts.mjs").IntentApproved =
    {
      id: "synthetic-event",
      v: 1,
      ts: "2026-09-27T00:00:00Z",
      actor: "human",
      type: "intent.approved",
      intent: "synthetic",
      source: "intent",
      parent: "synthetic-gate",
      wait_ms: 0,
      revision: evidence.revision,
      synthetic: true,
    };
  const validate = validateAudit;
  t.plan(3);
  t.assert.equal(validate({ ...incomplete, ...evidence }), true);
  t.assert.equal(validate({ ...incomplete, ...mismatched }), false);
  t.assert.equal(validate(incomplete), false);
});
