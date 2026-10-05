import { findEvent } from "./lib/audit.mjs";
import { elapsedMilliseconds } from "./lib/clock.mjs";
import { run } from "./lib/io.mjs";
import { claudeTokens } from "./lib/measure.mjs";
import { resumeContext } from "./lib/resume.mjs";

/** Record startup, resume and compact for the configured Intent, and pass registered sources a read-only resume summary. clear does not write. Stop is not a session end. */
export const main: import("./lib/contracts.mjs").HookMain = async (
  input,
  ctx,
) => {
  if (input.hook_event_name !== "SessionStart" || !ctx.intent)
    return { decision: "allow" };
  const begun = ctx.now();
  const context = await resumeContext(input, ctx);
  const summary = context ? { context } : {};
  if (
    input.source !== "startup" &&
    input.source !== "resume" &&
    input.source !== "compact"
  )
    return { decision: "allow", ...summary };
  const type =
    input.source === "startup"
      ? "session.started"
      : input.source === "resume"
        ? "session.resumed"
        : "session.compacted";
  const id = ctx.newId(
    input.session_id,
    JSON.stringify([type, ctx.harness, ctx.intent]),
  );
  // A damaged log still yields the resume or compact summary. Startup keeps failing open
  // without one, because that record is the session's first audit write.
  let previous: Awaited<ReturnType<typeof findEvent>>;
  try {
    previous = await findEvent(ctx.audit, id);
  } catch (error) {
    if (input.source === "startup") throw error;
    return { decision: "allow", ...summary };
  }
  const kept =
    previous &&
    previous.type === type &&
    previous.actor === "hook" &&
    !previous.synthetic &&
    (type !== "session.resumed" || typeof previous.duration_ms === "number")
      ? previous
      : undefined;
  const ts = kept ? kept.ts : ctx.now();
  const stored =
    kept && type === "session.resumed" && typeof kept.duration_ms === "number"
      ? kept.duration_ms
      : null;
  const restored =
    type !== "session.resumed"
      ? null
      : stored !== null
        ? stored
        : elapsedMilliseconds(begun, ts);
  if (type === "session.resumed" && typeof restored !== "number")
    return { decision: "allow", ...summary };
  const observed = kept ? kept.tokens : claudeTokens(ctx.harness, input);
  // Key order matches the session.started golden: type precedes ts.
  const event = {
    id,
    v: 1,
    type,
    ts,
    actor: "hook",
    harness: ctx.harness,
    intent: ctx.intent,
    session: input.session_id,
    ...(type === "session.resumed" ? { duration_ms: restored } : {}),
    ...(ctx.harness === "claude" && observed ? { tokens: observed } : {}),
  } as import("./lib/contracts.mjs").AuditEvent;
  return { decision: "allow", events: [event], ...summary };
};

run(main);
