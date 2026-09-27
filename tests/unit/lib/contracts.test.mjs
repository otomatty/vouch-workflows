import { test } from "node:test";
import { validator } from "../../helpers/registry.mjs";

/** @typedef {import('../../../core/hooks/lib/contracts.mjs').HookMain} HookMain */
/** @typedef {import('../../../core/hooks/lib/contracts.mjs').AuditEvent} AuditEvent */
/** @typedef {import('../../../core/hooks/lib/contracts.mjs').HookResult} HookResult */
/** @typedef {import('../../../core/hooks/lib/contracts.mjs').HookProcessResult} HookProcessResult */

test("JSDoc valid examples also satisfy the corresponding wire schemas", (t) => {
  /** @type {AuditEvent} */
  const audit = {
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
  /** @type {HookResult} */
  const result = { decision: "allow", events: [audit] };
  /** @type {HookProcessResult} */
  const processResult = { exitCode: 0, stdout: null, stderr: "" };
  t.plan(3);
  t.assert.equal(validator("audit-event")(audit), true, "HOOK-11: typed audit");
  t.assert.equal(
    validator("hook-result")(result),
    true,
    "HOOK-11: typed result",
  );
  t.assert.equal(
    validator("hook-process")(processResult),
    true,
    "HOOK-11: typed process",
  );
});

test("JSDoc rejects impossible decision and audit discriminants", (t) => {
  // These directives fail typecheck if the corresponding contract becomes permissive.
  /** @type {HookResult} */
  // @ts-expect-error Denial requires a reason.
  const noReason = { decision: "deny" };
  /** @type {HookProcessResult} */
  // @ts-expect-error Only zero and two are permitted.
  const badExit = { exitCode: 1, stdout: null, stderr: "" };
  /** @type {AuditEvent} */
  const badType = {
    id: "test",
    v: 1,
    ts: "2026-09-27T00:00:00Z",
    actor: "hook",
    // @ts-expect-error Unknown audit type.
    type: "unknown.event",
  };
  /** @type {AuditEvent} */
  // @ts-expect-error Codex cannot report Claude token usage.
  const badTokens = {
    id: "test",
    v: 1,
    ts: "2026-09-27T00:00:00Z",
    actor: "hook",
    type: "session.started",
    session: "s",
    harness: "codex",
    tokens: { in: 1, out: 2 },
  };
  /** @type {HookMain} */
  // @ts-expect-error HookMain must return a decision.
  const badMain = () => ({ exitCode: 0 });
  t.plan(5);
  t.assert.equal(validator("hook-result")(noReason), false, "HOOK-11");
  t.assert.equal(validator("hook-process")(badExit), false, "HOOK-11");
  t.assert.equal(validator("audit-event")(badType), false, "HOOK-11");
  t.assert.equal(validator("audit-event")(badTokens), false, "HOOK-11");
  t.assert.equal(
    validator("hook-result")(
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
        },
      ),
    ),
    false,
    "HOOK-11",
  );
});
