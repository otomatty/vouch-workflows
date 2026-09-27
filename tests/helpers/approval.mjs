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
