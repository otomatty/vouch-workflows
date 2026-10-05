import { test } from "node:test";
import { isAuditEvent } from "../../../core/hooks/lib/validation.mjs";
import {
  command,
  event,
  gitOf,
  ids,
  jsonl,
  plan,
  project,
  review,
  rows,
} from "../../helpers/lifecycle.mjs";

test("gate answers bind the latest live gate and a reason token", async (t) => {
  const files = project({
    "audit/events.jsonl": jsonl([
      event("old", { type: "gate.opened", source: "intent", synthetic: true }),
      event("gate-1", { type: "gate.opened", source: "intent" }),
      event("gate-2", {
        type: "gate.opened",
        source: "pr",
        ts: "2026-09-30T00:00:04.000Z",
      }),
    ]),
  });
  const early = await command(files, ["gate-approved"], {
    now: "2026-09-30T00:00:01.000Z",
  });
  const approved = await command(files, ["gate-approved"]);
  const bad = await command(files, ["gate-rejected", "needs_work"]);
  const rejected = await command(files, ["gate-rejected", "needs-work"]);
  const none = await command(project({}), ["gate-approved"]);
  const record = rows(files).find((row) => row.type === "gate.approved");
  const denial = rows(files).find((row) => row.type === "gate.rejected");
  t.plan(7);
  t.assert.deepEqual(
    [ids(early)[0], ids(bad)[0], ids(none)[0]],
    ["LIFECYCLE-EVIDENCE", "LIFECYCLE-ARGS", "LIFECYCLE-EVIDENCE"],
  );
  t.assert.equal(approved.ok, true);
  t.assert.equal(rejected.ok, true);
  t.assert.equal(record.parent, "gate-2");
  t.assert.equal(record.source, "pr");
  t.assert.equal(record.wait_ms, 6000);
  t.assert.deepEqual([denial.reason, denial.parent], ["needs-work", "gate-2"]);
});

test("review records count review.md from the installed harness", async (t) => {
  const files = project({ "review.md": review });
  const bare = await command(files, ["review-requested", "1"], {
    harness: null,
  });
  const zero = await command(files, ["review-requested", "0"]);
  const opened = await command(files, ["review-requested", "2"]);
  const unread = await command(project({}), ["review-completed", "2"]);
  const completed = await command(files, ["review-completed", "2"], {
    now: "2026-09-30T00:00:16.000Z",
  });
  const record = rows(files).find((row) => row.type === "review.completed");
  t.plan(6);
  t.assert.deepEqual(
    [ids(bare)[0], ids(zero)[0], ids(unread)[0]],
    ["LIFECYCLE-HARNESS", "LIFECYCLE-ARGS", "LIFECYCLE-UNMEASURED"],
  );
  t.assert.equal(opened.ok, true);
  t.assert.equal(completed.ok, true);
  t.assert.deepEqual(
    [record.findings, record.sabotage, record.duration_ms, record.iteration],
    [1, { tried: 2, caught: 1 }, 6000, 2],
  );
  t.assert.equal(record.harness, "claude");
  t.assert.equal(isAuditEvent(record), true);
});

test("learn-recorded counts added rules rows only when the file is tracked", async (t) => {
  const files = project({});
  const extra = await command(files, ["learn-recorded", "1"], {
    git: gitOf({ "ls-files -- vouch/rules.md": "vouch/rules.md\n" }),
  });
  const untracked = await command(files, ["learn-recorded"], {
    git: gitOf({}),
  });
  const unread = await command(files, ["learn-recorded"], {
    git: gitOf({ "ls-files -- vouch/rules.md": "vouch/rules.md\n" }),
  });
  const empty = await command(files, ["learn-recorded"], {
    git: gitOf({
      "ls-files -- vouch/rules.md": "vouch/rules.md\n",
      "diff -U0 HEAD -- vouch/rules.md": "+++ b/vouch/rules.md\n",
    }),
  });
  const counted = project({});
  const added = await command(counted, ["learn-recorded"], {
    git: gitOf({
      "ls-files -- vouch/rules.md": "vouch/rules.md\n",
      "diff -U0 HEAD -- vouch/rules.md":
        "+++ b/vouch/rules.md\n+| K-1 | keep |\n+| K-2 | more |\n",
    }),
  });
  t.plan(5);
  t.assert.deepEqual(
    [ids(extra)[0], ids(untracked)[0], ids(unread)[0]],
    ["LIFECYCLE-ARGS", "LIFECYCLE-UNMEASURED", "LIFECYCLE-UNMEASURED"],
  );
  t.assert.equal(rows(files).at(-1).rules_added, 0);
  t.assert.equal(empty.ok, true);
  t.assert.equal(added.ok, true);
  t.assert.equal(rows(counted).at(-1).rules_added, 2);
});

test("session-ended uses the latest live start or resume for that session", async (t) => {
  const files = project({
    "audit/events.jsonl": jsonl([
      event("synthetic", {
        type: "session.started",
        session: "sess-1",
        synthetic: true,
      }),
      event("started", { type: "session.started", session: "sess-1" }),
      event("resumed", {
        type: "session.resumed",
        session: "sess-1",
        duration_ms: 5,
        ts: "2026-09-30T00:00:04.000Z",
      }),
      event("other", { type: "session.started", session: "sess-2" }),
    ]),
  });
  const bad = await command(files, ["session-ended", "sess_1"]);
  const missing = await command(files, ["session-ended", "sess-9"]);
  const ended = await command(files, ["session-ended", "sess-1"]);
  const reversed = project({
    "audit/events.jsonl": jsonl([
      event("started", {
        type: "session.started",
        session: "sess-1",
        ts: "2026-10-01T00:00:00.000Z",
      }),
    ]),
  });
  const record = rows(files).at(-1);
  const other = project({
    "vouch/intents/other-intent/intent.md": plan,
  });
  const separated = await command(other, ["intent-created"], {
    intent: "other-intent",
  });
  t.plan(7);
  t.assert.deepEqual(
    [
      ids(bad)[0],
      ids(missing)[0],
      ids(await command(reversed, ["session-ended", "sess-1"]))[0],
    ],
    ["LIFECYCLE-ARGS", "LIFECYCLE-EVIDENCE", "LIFECYCLE-EVIDENCE"],
  );
  t.assert.equal(ended.ok, true);
  t.assert.equal(record.type, "session.ended");
  t.assert.deepEqual(
    [record.parent, record.duration_ms, record.session],
    ["resumed", 6000, "sess-1"],
  );
  t.assert.equal(separated.ok, true);
  t.assert.equal(
    rows(other, "vouch/intents/other-intent/audit/events.jsonl")[0].intent,
    "other-intent",
  );
  t.assert.equal(
    rows(files).some((row) => row.intent === "other-intent"),
    false,
  );
});
