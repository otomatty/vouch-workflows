import commands from "../../registry/intent-review.json" with { type: "json" };

// The `vouch migrate approve <sha256>` input (docs/development/migrate.md). Every prompt passes this
// gate, so it loads only the prompt-command registry; the recorder and the migration registry load
// when the command actually arrives.

export const approveMigration: import("./runtime-contracts.mjs").PromptRecorder =
  async (input, ctx) => {
    if (input.hook_event_name !== "UserPromptSubmit") return null;
    const prefix = commands.migrateApprovePrefix;
    const word = prefix.trimEnd();
    const { prompt } = input;
    if (
      prompt !== word &&
      !(prompt.startsWith(word) && /^\s/.test(prompt.slice(word.length)))
    )
      return null;
    const intent = ctx.intent;
    if (!intent) return null;
    const digest = prompt.slice(prefix.length);
    if (
      !prompt.startsWith(prefix) ||
      !new RegExp(commands.migrateDigestPattern).test(digest)
    )
      return {
        decision: "deny",
        reason:
          "VOUCH-MIGRATE-COMMAND: exact `vouch migrate approve <sha256 of migration.md>` input required",
      };
    const { recordApproval } = await import("./migrate-approval.mjs");
    return recordApproval(input, ctx, intent, digest);
  };
