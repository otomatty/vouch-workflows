import migration from "../../registry/migration.json" with { type: "json" };
import { identifySubmission } from "./approval.mjs";
import { intentHome, listEvents } from "./audit.mjs";
import { sha256Hex } from "./clock.mjs";

// A person's approval of the migration report (docs/development/migrate.md). It records
// migration.completed for the exact bytes named; it is never an Intent approval or a confirmation.

/** @param {string} reason @returns {import('./contracts.mjs').HookResult} */
const deny = (reason) => ({ decision: "deny", reason });

/** @param {string} text @returns {{status:string,files:number}|null} */
function frontmatter(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  /** @param {string} key */
  const values = (key) =>
    [
      ...(front ?? "").matchAll(new RegExp(`^${key}:[ \\t]*(.*?)\\r?$`, "gm")),
    ].map((match) => match[1] ?? "");
  const [status, files] = [values("status"), values("files")];
  if (
    status.length !== 1 ||
    files.length !== 1 ||
    !/^\d{1,9}$/.test(files[0] ?? "")
  )
    return null;
  return { status: status[0] ?? "", files: Number(files[0]) };
}

/** @type {import('./runtime-contracts.mjs').PromptRecorder} */
export async function approveMigration(input, ctx) {
  if (input.hook_event_name !== "UserPromptSubmit") return null;
  const word = migration.approve.prefix.trimEnd();
  const { prompt } = input;
  if (
    prompt !== word &&
    !(prompt.startsWith(word) && /^\s/.test(prompt.slice(word.length)))
  )
    return null;
  const intent = ctx.intent;
  if (!intent) return null;
  const digest = prompt.slice(migration.approve.prefix.length);
  if (
    !prompt.startsWith(migration.approve.prefix) ||
    !new RegExp(migration.approve.pattern).test(digest)
  )
    return deny(
      "VOUCH-MIGRATE-COMMAND: exact `vouch migrate approve <sha256 of migration.md>` input required",
    );
  const submission = identifySubmission(input, ctx.harness);
  if (!submission)
    return deny(
      "VOUCH-MIGRATE-IDENTITY: captured prompt or turn identity required",
    );
  const path = `${intentHome(intent)}/${migration.brief}`;
  const text = await ctx.readText(path);
  const front = text === null ? null : frontmatter(text);
  if (text === null || front?.status !== "draft")
    return deny(
      `VOUCH-MIGRATE-BRIEF: ${path} must exist with status: draft and one files count`,
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
  const previous = (await listEvents(ctx.audit)).find((item) => item.id === id);
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
