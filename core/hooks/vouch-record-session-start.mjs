import { findEvent } from "./lib/audit.mjs";
import { run } from "./lib/io.mjs";

/**
 * Record an observed Claude or Codex startup in the explicitly configured intent.
 * No state inference, approval, resumption or token estimation.
 * @type {import('./lib/contracts.mjs').HookMain}
 */
export async function main(input, ctx) {
  if (
    ctx.harness !== "claude" ||
    input.hook_event_name !== "SessionStart" ||
    input.source !== "startup" ||
    !ctx.intent
  )
    return { decision: "allow" };
  const id = ctx.newId(
    input.session_id,
    JSON.stringify(["session.started", ctx.harness, ctx.intent]),
  );
  const previous = await findEvent(ctx.audit, id);
  return {
    decision: "allow",
    events: [
      {
        id,
        v: 1,
        type: "session.started",
        ts: previous?.ts ?? ctx.now(),
        actor: "hook",
        harness: ctx.harness,
        intent: ctx.intent,
        session: input.session_id,
      },
    ],
  };
}

run(main);
