import { test } from "node:test";
import { recordApproval } from "../../../core/hooks/lib/migrate-approval.mjs";
import { intent } from "../../helpers/migrate.mjs";

// The full approval paths run through the gate in migrate-approve.test.mjs; the recorder itself
// refuses an input without a captured identity before reading anything.
test("the recorder refuses a prompt without a captured identity before any read", async (t) => {
  let reads = 0;
  const result = await recordApproval(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "s-1",
      cwd: "/project",
      prompt: `vouch migrate approve ${"a".repeat(64)}`,
    },
    {
      harness: "claude",
      readText: async () => {
        reads++;
        return null;
      },
    } as never,
    intent,
    "a".repeat(64),
  );
  t.plan(2);
  t.assert.equal(
    result.decision === "deny" && result.reason.split(":")[0],
    "VOUCH-MIGRATE-IDENTITY",
  );
  t.assert.equal(reads, 0);
});
