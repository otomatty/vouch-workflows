import { findEvent } from "./lib/audit.mjs";
import { run } from "./lib/io.mjs";
import { resumeContext } from "./lib/resume.mjs";

/**
 * Record an observed Claude or Codex startup in the explicitly configured intent, and pass the
 * registered sources a read-only resume summary of it. No approval, state cache or next step.
 * @type {import('./lib/contracts.mjs').HookMain}
 */
export async function main(input, ctx) {
  if (input.hook_event_name !== "SessionStart" || !ctx.intent)
    return { decision: "allow" };
  const context = await resumeContext(input, ctx);
  const summary = context ? { context } : {};
  if (input.source !== "startup") return { decision: "allow", ...summary };
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
    ...summary,
  };
}

run(main);
