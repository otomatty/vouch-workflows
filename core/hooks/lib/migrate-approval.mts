import migration from "../../registry/migration.json" with { type: "json" };
import { identifySubmission } from "./approval.mjs";
import { intentHome, listEvents, migratedOrigin } from "./audit.mjs";
import { sha256Hex } from "./clock.mjs";

// The recorder behind `vouch migrate approve` (docs/development/migrate.md), loaded only when that
// input arrives. It records migration.completed for the exact bytes named; never an Intent approval.

const deny = (reason: string): import("./contracts.mjs").HookResult => ({
  decision: "deny",
  reason,
});

export type Front = {
  status: string;
  source: string;
  intent: string;
  files: number;
  blocks: number;
};

/** The report's single frontmatter values; null when any is missing, repeated or malformed. */
function frontmatter(text: string): Front | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  const value = (key: string) => {
    const found = [
      ...(front ?? "").matchAll(new RegExp(`^${key}:[ \\t]*(.*?)\\r?$`, "gm")),
    ].map((match) => match[1] ?? "");
    return found.length === 1 ? (found[0] ?? null) : null;
  };
  const [status, source, intent, files, blocks] = [
    "status",
    "source",
    "intent",
    "files",
    "blocks",
  ].map(value);
  if (!status || !source || !intent || !files || !blocks) return null;
  if (!/^\d{1,9}$/.test(files) || !/^\d{1,9}$/.test(blocks)) return null;
  return {
    status,
    source,
    intent,
    files: Number(files),
    blocks: Number(blocks),
  };
}

/** Why the report does not describe an applied migration; null when its every source file has an archive copy and the audit holds exactly its converted blocks. A hand-written report fails here. */
async function unapplied(
  ctx: import("./contracts.mjs").ReadyHookContext,
  text: string,
  front: Front,
  events: import("./contracts.mjs").AuditEvent[],
) {
  if (!new RegExp(migration.source.record).test(front.source))
    return `source ${front.source} is not a v2 record`;
  const table =
    text.split("<!-- sec:files -->")[1]?.split("<!-- sec:")[0] ?? "";
  const paths = [
    ...table.matchAll(/^\| `(aidlc\/spaces\/[^`|\\]+)` \| \d+ \|/gm),
  ].map((match) => match[1] ?? "");
  if (paths.length === 0 || paths.length !== front.files)
    return `the file table lists ${paths.length} of ${front.files} files`;
  for (const path of paths) {
    const copy = await ctx.locate(`${migration.archive}/${path}`);
    if (copy.kind !== "file" || copy.links !== 1)
      return `${migration.archive}/${path} is not archived`;
  }
  const blocks = events.filter((event) => {
    const origin = migratedOrigin(event);
    return (
      !event.synthetic &&
      origin.original_type !== undefined &&
      origin.source_path?.startsWith(`${front.source}/`)
    );
  }).length;
  return blocks === front.blocks
    ? null
    : `the audit holds ${blocks} of ${front.blocks} migrated blocks`;
}

/** Records the person's approval once the gate in migrate-approve.mjs has matched the command and the digest's form. */
export async function recordApproval(
  input: import("./contracts.mjs").HookInput & {
    hook_event_name: "UserPromptSubmit";
  },
  ctx: import("./contracts.mjs").ReadyHookContext,
  intent: string,
  digest: string,
): Promise<import("./contracts.mjs").HookResult> {
  const submission = identifySubmission(input, ctx.harness);
  if (!submission)
    return deny(
      "VOUCH-MIGRATE-IDENTITY: captured prompt or turn identity required",
    );
  const path = `${intentHome(intent)}/${migration.brief}`;
  const text = await ctx.readText(path);
  const front = text === null ? null : frontmatter(text);
  if (
    text === null ||
    !front ||
    front.status !== "draft" ||
    front.intent !== intent
  )
    return deny(
      `VOUCH-MIGRATE-BRIEF: ${path} must exist with status: draft, this Intent and one source, files and blocks value`,
    );
  const current = sha256Hex(Buffer.from(text, "utf8"));
  if (current !== digest)
    return deny(
      `VOUCH-MIGRATE-CHANGED: ${path} is ${current}; read the current report and approve that digest`,
    );
  // One record per report version; a resent approval keeps the first record and time.
  const id = ctx.newId(
    intent,
    JSON.stringify(["migration.completed", intent, digest]),
  );
  const events = await listEvents(ctx.audit);
  const missing = await unapplied(ctx, text, front, events);
  if (missing)
    return deny(
      `VOUCH-MIGRATE-UNAPPLIED: ${missing}; run apply for this record before approving`,
    );
  const previous = events.find((item) => item.id === id);
  return {
    decision: "deny",
    reason: `VOUCH-MIGRATE-RECORDED: ${id}; ${migration.brief} ${digest}; not an Intent approval`,
    events: [
      {
        id,
        v: 1,
        type: "migration.completed",
        ts: previous?.ts ?? ctx.now(),
        actor: "human",
        harness: previous?.harness ?? ctx.harness,
        intent,
        session: previous?.session ?? input.session_id,
        files_migrated: front.files,
        revision: { path: "migration.md", sha256: digest },
        submission:
          previous?.type === "migration.completed" && previous.submission
            ? previous.submission
            : submission,
      },
    ],
  };
}
