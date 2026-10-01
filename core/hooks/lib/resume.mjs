import approvals from "../../registry/approval.json" with { type: "json" };
import operations from "../../registry/operations.json" with { type: "json" };
import { newId } from "./clock.mjs";
import { readLanguage, readPosition } from "./position.mjs";

// Text for the SessionStart summary and the statusline. Observations only, never instructions.
/** @typedef {import('./runtime-contracts.mjs').Position} Position */

/** @param {string} text @param {number} limit */
const bounded = (text, limit) => [...text].slice(0, limit).join("");
/** Untrusted text as one bounded JSON string. @param {string} value */
const quote = (value) => JSON.stringify(bounded(value, 80));
/** @param {string} value */
const id = (value) => (/^[\w.:-]{1,80}$/.test(value) ? value : quote(value));
/** A short value for the one-line display, or "?". @param {string} value */
const token = (value) => (/^[\w.-]{1,24}$/.test(value) ? value : "?");
/** Invalid lines, a repeated ID (which hides its later record) or an unreadable log leave the rest
 * inconclusive. @param {import('./runtime-contracts.mjs').AuditObservation} audit */
const partialAudit = (audit) =>
  audit.invalid.length > 0 ||
  audit.duplicates.length > 0 ||
  Boolean(audit.unreadable);

/** @type {import('./runtime-contracts.mjs').FormatPosition} */
export function formatSummary(position) {
  const labels = operations.labels[position.language];
  /** @param {string[]} items */
  const list = (items) => {
    const shown = items.slice(0, operations.resume.items);
    const more = items.length - shown.length;
    return items.length
      ? `${shown.join(", ")}${more ? `, +${more} ${labels.more}` : ""}`
      : labels.none;
  };
  const { audit, checkpoints } = position;
  const partial = partialAudit(audit);
  const approval = {
    none: "",
    evidence: ` (${labels.evidence})`,
    declared: ` (${labels.no_evidence})`,
  }[position.approval];
  const artifacts = position.artifacts.map((item) => {
    const name = item.path.split("/").at(-1);
    if (!item.present) return `${name}: ${labels.absent}`;
    if (item.unreadable) return `${name}: ${labels.unreadable}`;
    if (item.status === null) return `${name}: ${labels.present}`;
    return `${name}: ${quote(item.status)}${item.stage === "intent" ? approval : ""}`;
  });
  const unanswered = position.unanswered.map(
    (q) =>
      `${id(q.question)} (${id(q.event)}${q.default ? `, ${labels.line_defaulted} ${id(q.default)}` : ""})`,
  );
  return [
    labels.summary,
    `${labels.intent}: ${position.intent}`,
    `${labels.artifacts}: ${artifacts.join("; ")}`,
    checkpoints.state === "observed"
      ? `${labels.checkpoints}: ${labels.missing}: ${checkpoints.missing.join(", ") || labels.none} (${checkpoints.required.length - checkpoints.missing.length}/${checkpoints.required.length})`
      : `${labels.checkpoints}: ${labels.unknown} (${quote(checkpoints.reason)})`,
    `${labels.unanswered}: ${unanswered.length || !partial ? list(unanswered) : labels.unknown}`,
    `${labels.defaulted}: ${list(position.defaulted.map((d) => `${id(d.question)} → ${id(d.choice)} (${id(d.event)}, ${id(d.defaulted)})`))}`,
    ...(position.uncertain.length
      ? [`${labels.uncertain}: ${list(position.uncertain.map(id))}`]
      : []),
    `${labels.audit}: ${audit.path}, ${audit.unreadable ? labels.unreadable : `${audit.events} (synthetic ${audit.synthetic})`}${partial ? `; ${labels.partial}` : ""}${audit.invalid.length ? ` (L${audit.invalid.join(", L")})` : ""}${audit.duplicates.length ? `; duplicate ${list(audit.duplicates.map(id))}` : ""}`,
    labels.next,
  ].join("\n");
}

/** @type {import('./runtime-contracts.mjs').FormatPosition} */
export function formatStatusline(position) {
  const labels = operations.labels[position.language];
  const stages = position.artifacts
    .filter((item) => item.present)
    .map((item) =>
      item.unreadable
        ? `${item.stage}:?`
        : item.status === null
          ? item.stage
          : `${item.stage}:${token(item.status)}${item.stage === "intent" && position.approval === "declared" ? `(${labels.line_no_evidence})` : ""}`,
    )
    .join(" ");
  const { checkpoints } = position;
  const partial = partialAudit(position.audit);
  const open = position.unanswered.map((q) => token(q.question)).join(" ");
  const head = [`Vouch ${position.intent}`, stages].filter(Boolean).join(" | ");
  const tail = [
    position.approval === "none"
      ? `${labels.line_checkpoints} ${checkpoints.state === "observed" ? `${checkpoints.required.length - checkpoints.missing.length}/${checkpoints.required.length}` : "?"}`
      : "",
    open || !partial ? `${labels.line_unanswered} ${open || 0}` : "",
    position.defaulted.length
      ? `${labels.line_defaulted} ${position.defaulted.map((d) => token(d.question)).join(" ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");
  // The head shortens first; the audit warning is never cut off.
  const warning = partial ? ` | ${labels.line_partial}` : "";
  const limit = operations.statusline.chars;
  const size = (/** @type {string} */ text) => [...text].length;
  const body = tail ? ` | ${tail}` : "";
  if (size(head + body + warning) <= limit) return head + body + warning;
  const room = limit - size(body + warning);
  return room > 1
    ? `${bounded(head, room - 1)}…${body}${warning}`
    : `${bounded(head + body, limit - size(warning) - 1)}…${warning}`;
}

/** @type {import('./runtime-contracts.mjs').StatuslineMain} */
export async function showStatusline(files, intent, _harness) {
  if (!intent)
    return `Vouch: ${operations.labels[readLanguage(await files.readText(approvals.rules))].unset}`;
  return formatStatusline(
    await readPosition(
      { readText: (path) => files.readText(path), newId },
      intent,
    ),
  );
}

/** The resume summary for a registered SessionStart source of the configured Intent, else undefined.
 * @param {import('./contracts.mjs').HookInput} input @param {import('./contracts.mjs').ReadyHookContext} ctx */
export async function resumeContext(input, ctx) {
  if (
    input.hook_event_name !== "SessionStart" ||
    !ctx.intent ||
    !operations.resume.sources[ctx.harness].includes(input.source)
  )
    return undefined;
  return formatSummary(await readPosition(ctx, ctx.intent));
}
