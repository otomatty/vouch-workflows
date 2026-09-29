import approval from "../../registry/approval.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import guard from "../../registry/write-guard.json" with { type: "json" };
import { findApproval, snapshotIntent } from "./approval.mjs";
import { normalizeSegment, parsePatch } from "./areas.mjs";
import { listEvents } from "./audit.mjs";
import { parseShell, programOf } from "./shell.mjs";

// Build start boundary; see docs/development/approval-boundary.md.
const [home = "vouch"] = guard.intents;
const artifacts = approval.build.map((stage) =>
  normalizeSegment(
    documents.artifacts[/** @type {'build'|'verify'} */ (stage)],
  ),
);

/**
 * Words a shell command may write: arguments of redirecting commands and of registered writers.
 * Null when a write is built at run time and cannot be verified.
 * @param {string} text @returns {string[]|null}
 */
function shellTargets(text) {
  const parsed = parseShell(text);
  /** @type {string[]} */ const words = [];
  for (const command of parsed.commands) {
    const [program = "", ...args] = programOf(command);
    const writer =
      command.writes ||
      approval.writers.includes(program) ||
      (program === "sed" &&
        args.some((arg) => /^(?:-[^-]*i|--in-place)/.test(arg)));
    if (!writer) continue;
    if (parsed.dynamic) return null;
    // Destinations usually come last, so the reason names them first.
    words.push(...args.filter((arg) => !arg.startsWith("-")).reverse());
  }
  return words;
}

/** @type {import('./runtime-contracts.mjs').GuardBuild} */
export async function guardBuild(input, ctx) {
  if (input.hook_event_name !== "PreToolUse" || !ctx.intent)
    return { decision: "allow" };
  /** @type {Record<string,string>} */ const tools = guard.tools[ctx.harness];
  const kind = Object.hasOwn(tools, input.tool_name)
    ? tools[input.tool_name]
    : undefined;
  const subject =
    kind === "patch" || kind === "shell"
      ? input.tool_input.command
      : input.tool_input.file_path;
  if (!kind || typeof subject !== "string") return { decision: "allow" };
  const paths =
    kind === "patch"
      ? parsePatch(subject).flatMap((operation) =>
          operation.to === null
            ? [operation.path]
            : [operation.path, operation.to],
        )
      : kind === "shell"
        ? shellTargets(subject)
        : [subject];
  const scope = [...guard.intents, ctx.intent].map(normalizeSegment);
  /** @type {string|null} */ let target = paths === null ? subject : null;
  for (const path of paths ?? []) {
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
