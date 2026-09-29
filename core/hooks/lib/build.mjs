import approval from "../../registry/approval.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import guard from "../../registry/write-guard.json" with { type: "json" };
import { findApproval, snapshotIntent } from "./approval.mjs";
import { normalizeSegment, parsePatch } from "./areas.mjs";
import { listEvents } from "./audit.mjs";

// Build start boundary; see docs/development/approval-boundary.md.
const [home = "vouch"] = guard.intents;
const artifacts = approval.build.map((stage) =>
  normalizeSegment(
    documents.artifacts[/** @type {'build'|'verify'} */ (stage)],
  ),
);

/** @type {import('./runtime-contracts.mjs').GuardBuild} */
export async function guardBuild(input, ctx) {
  if (input.hook_event_name !== "PreToolUse" || !ctx.intent)
    return { decision: "allow" };
  /** @type {Record<string,string>} */ const tools = guard.tools[ctx.harness];
  const kind = Object.hasOwn(tools, input.tool_name)
    ? tools[input.tool_name]
    : undefined;
  const subject =
    kind === "patch" ? input.tool_input.command : input.tool_input.file_path;
  if (
    (kind !== "write" && kind !== "edit" && kind !== "patch") ||
    typeof subject !== "string"
  )
    return { decision: "allow" };
  const paths =
    kind === "patch"
      ? parsePatch(subject).flatMap((operation) =>
          operation.to === null
            ? [operation.path]
            : [operation.path, operation.to],
        )
      : [subject];
  const scope = [...guard.intents, ctx.intent].map(normalizeSegment);
  /** @type {string|null} */ let target = null;
  for (const path of paths) {
    const at = await ctx.locate(path, input.cwd);
    if (at.inside === null) continue;
    // Only the canonical vouch/ spelling is exempt; any spelling of a Build artifact is not.
    const parts = at.inside.split("/");
    const names = parts.map(normalizeSegment);
    const build =
      names.length === scope.length + 1 &&
      scope.every((name, i) => names[i] === name) &&
      artifacts.includes(`${names.at(-1)}`);
    if (parts[0] !== home || build) {
      target = at.inside;
      break;
    }
  }
  if (target === null) return { decision: "allow" };
  let detail;
  try {
    const text = await ctx.readText(
      `${guard.intents.join("/")}/${ctx.intent}/${documents.artifacts.intent}`,
    );
    const snapshot = text === null ? null : snapshotIntent(text);
    if (text === null) detail = `no ${documents.artifacts.intent}`;
    else if (!snapshot) detail = `unsupported ${documents.artifacts.intent}`;
    else if (snapshot.status === "draft")
      detail = `${documents.artifacts.intent} is a draft`;
    else if (
      !findApproval({
        text,
        events: await listEvents(ctx.audit),
        intent: ctx.intent,
        newId: ctx.newId,
      })
    )
      detail = `no approval evidence for revision ${snapshot.revision.sha256.slice(0, 12)}`;
    else return { decision: "allow" };
  } catch {
    detail = "evidence unreadable";
  }
  const shown = target.replace(/\p{Cc}/gu, "?").slice(0, 200);
  return {
    decision: "deny",
    reason: `VOUCH-BUILD-UNAPPROVED: ${input.tool_name} ${shown}; implementation waits for an approved plan (${detail})`,
  };
}
