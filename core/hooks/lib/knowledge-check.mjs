import { identifySubmission } from "./approval.mjs";
import { findEvent } from "./audit.mjs";
import { inspectReferences } from "./citation.mjs";
import { elapsedMilliseconds, sha256Hex } from "./clock.mjs";
import { inspectKnowledge } from "./freshness.mjs";
import { readGit } from "./git.mjs";
import { inspectQuestions } from "./questions.mjs";

/** Explicit installed commands only; never authorizes or performs a rescan.
 * @param {import('./contracts.mjs').HookInput} input
 * @param {import('./contracts.mjs').ReadyHookContext} ctx
 * @param {import('./runtime-contracts.mjs').GitPort} [suppliedGit]
 * @returns {Promise<import('./contracts.mjs').HookResult|null>} */
export async function checkKnowledge(input, ctx, suppliedGit) {
  if (
    input.hook_event_name !== "UserPromptSubmit" ||
    !ctx.intent ||
    !/^vouch (?:knowledge|citations)(?: |$)/.test(input.prompt)
  )
    return null;
  const intent = ctx.intent;
  const commands = [
    "vouch knowledge check",
    "vouch knowledge refresh",
    "vouch citations check",
  ];
  const submission = identifySubmission(input, ctx.harness);
  if (!commands.includes(input.prompt) || !submission)
    return {
      decision: "deny",
      reason:
        "VOUCH-KNOWLEDGE-COMMAND: exact command and captured submission identity required",
    };
  const key = JSON.stringify([
    "knowledge",
    ctx.harness,
    ctx.intent,
    submission,
  ]);
  const id = ctx.newId(input.session_id, key);
  const previous = await findEvent(ctx.audit, id);
  if (previous?.synthetic)
    return {
      decision: "deny",
      reason: "VOUCH-KNOWLEDGE-EVIDENCE: synthetic history cannot be reused",
    };
  const start = ctx.now();
  /** @type {[string,string|null][]} */ const observed = [];
  const original = ctx;
  ctx = {
    ...ctx,
    readText: async (path) => {
      const text = await original.readText(path);
      observed.push([
        path,
        text === null ? null : sha256Hex(Buffer.from(text)),
      ]);
      return text;
    },
  };
  const git = suppliedGit ?? readGit(ctx.projectRoot);
  const head = (await git("rev-parse", "--verify", "HEAD"))?.trim() ?? null;
  const { index, errors } = await inspectKnowledge(ctx, head);
  const citation = input.prompt === "vouch citations check";
  if (citation) {
    const base = `vouch/intents/${ctx.intent}/`;
    for (const name of [
      "intent.md",
      "design.md",
      "build-log.md",
      "review.md",
      "decisions.md",
    ]) {
      const text = await ctx.readText(base + name);
      if (text === null) {
        if (["intent.md", "decisions.md"].includes(name))
          errors.push(`missing artifact: ${name}`);
        continue;
      }
      errors.push(
        ...(await inspectReferences(text, ctx, head, index)).map(
          (e) => `${name}: ${e}`,
        ),
      );
      if (name === "decisions.md")
        errors.push(...(await inspectQuestions(text, ctx, head, index)));
    }
  }
  const end = previous?.ts ?? ctx.now();
  const duration_ms = previous?.duration_ms ?? elapsedMilliseconds(start, end);
  if (duration_ms === null)
    throw new Error("VOUCH-KNOWLEDGE-CLOCK: invalid measurement");
  const check = citation ? "citation" : "freshness";
  const reason = errors.length
    ? `VOUCH-KNOWLEDGE: failed; explorer/reviewer follow-up: ${errors.join("; ")}`
    : input.prompt === "vouch knowledge refresh"
      ? "VOUCH-KNOWLEDGE: refreshed"
      : "VOUCH-KNOWLEDGE: passed";
  const common = {
    v: /** @type {const} */ (1),
    actor: /** @type {const} */ ("hook"),
    ts: end,
    intent,
    session: input.session_id,
    harness: ctx.harness,
    duration_ms,
    knowledge: {
      sha256: sha256Hex(Buffer.from(JSON.stringify(observed))),
      ...(index ? { generation: index.generation } : {}),
      ...(head ? { head } : {}),
    },
  };
  /** @type {import('./contracts.mjs').AuditEvent[]} */
  const events = [
    {
      ...common,
      id,
      type: "hook.check",
      check,
      result: errors.length ? "fail" : "pass",
      missing: errors.filter((e) => e.includes("missing")).length,
      stale: errors.filter((e) => e.includes("stale")).length,
    },
  ];
  if (errors.length)
    events.push({
      ...common,
      id: ctx.newId(input.session_id, `${key}:denied`),
      type: "hook.denied",
      check,
      result: "fail",
      reason,
    });
  else if (input.prompt === "vouch knowledge refresh" && index)
    events.push({
      ...common,
      id: ctx.newId(input.session_id, `${key}:refreshed`),
      type: "knowledge.refreshed",
      scope: index.scope,
    });
  return { decision: "deny", reason, events };
}
