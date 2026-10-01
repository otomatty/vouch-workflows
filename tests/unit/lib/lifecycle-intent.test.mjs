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
  rows,
} from "../../helpers/lifecycle.mjs";
import { answered, asked } from "../../helpers/resume.mjs";

test("intent-completed keeps one copy of a wait shared by the gate and the approval", async (t) => {
  const open = asked("Q-1");
  const files = project({
    "intent.md": plan,
    "audit/events.jsonl": jsonl([
      event("old", {
        type: "intent.created",
        actor: "model",
        risk: "L",
        synthetic: true,
      }),
      event("made", { type: "intent.created", actor: "model", risk: "M" }),
      { ...answered(open, "A"), wait_ms: 2000 },
      event("approved", {
        type: "intent.approved",
        actor: "human",
        source: "intent",
        parent: "gate-1",
        wait_ms: 4000,
      }),
      event("shared", {
        type: "gate.approved",
        actor: "human",
        source: "intent",
        parent: "gate-1",
        wait_ms: 4000,
      }),
      event("separate", {
        type: "gate.rejected",
        actor: "human",
        source: "pr",
        parent: "gate-2",
        wait_ms: 500,
        reason: "needs-work",
      }),
      event("elsewhere", {
        type: "question.answered",
        actor: "human",
        intent: "other-intent",
        question: "Q-9",
        choice: "A",
        parent: "other",
        wait_ms: 90000,
      }),
    ]),
  });
  const done = await command(files, ["intent-completed"]);
  const record = rows(files).at(-1);
  const backwards = project({
    "intent.md": plan,
    "audit/events.jsonl": jsonl([
      event("made", {
        type: "intent.created",
        actor: "model",
        risk: "L",
        ts: "2026-10-01T00:00:00.000Z",
      }),
    ]),
  });
  const negative = project({
    "intent.md": plan,
    "audit/events.jsonl": jsonl([
      event("made", { type: "intent.created", actor: "model", risk: "L" }),
      event("approved", {
        type: "intent.approved",
        actor: "human",
        source: "intent",
        parent: "gate-1",
        wait_ms: 11000,
      }),
      event("shared", {
        type: "gate.approved",
        actor: "human",
        source: "intent",
        parent: "gate-1",
        wait_ms: 11000,
      }),
    ]),
  });
  t.plan(7);
  t.assert.equal(done.ok, true);
  t.assert.equal(record.type, "intent.completed");
  t.assert.deepEqual(
    [
      record.parent,
      record.duration_ms,
      record.human_wait_ms,
      record.human_review_ms,
      record.ai_work_ms,
    ],
    ["made", 10000, 2000, 4500, 3500],
  );
  t.assert.equal(isAuditEvent(record), true);
  t.assert.deepEqual(ids(await command(files, ["intent-completed", "extra"])), [
    "LIFECYCLE-ARGS",
  ]);
  t.assert.deepEqual(
    ids(await command(project({ "intent.md": plan }), ["intent-completed"])),
    ["LIFECYCLE-UNMEASURED"],
  );
  t.assert.deepEqual(
    [
      ids(await command(backwards, ["intent-completed"]))[0],
      ids(await command(negative, ["intent-completed"]))[0],
    ],
    ["LIFECYCLE-UNMEASURED", "LIFECYCLE-UNMEASURED"],
  );
});

test("stage records use the parent clock and refuse an unmeasured build", async (t) => {
  const files = project({
    "audit/events.jsonl": jsonl([
      event("estimated", {
        type: "stage.started",
        stage: "design",
        estimated: true,
        original_type: "STAGE_STARTED",
        raw: "stage",
        source_path: "aidlc/audit/a.md#L1",
      }),
    ]),
  });
  const refused = await command(files, ["stage-completed", "build"]);
  const unknown = await command(files, ["stage-started", "ship"]);
  const bare = await command(files, ["stage-started"]);
  const missing = await command(files, ["stage-completed", "design"]);
  const started = await command(files, ["stage-started", "design"]);
  const completed = await command(files, ["stage-completed", "design"], {
    now: "2026-09-30T00:00:12.000Z",
  });
  const types = rows(files).map((row) => row.type);
  t.plan(6);
  t.assert.deepEqual(
    [ids(refused)[0], ids(unknown)[0], ids(bare)[0], ids(missing)[0]],
    [
      "LIFECYCLE-UNMEASURED",
      "LIFECYCLE-ARGS",
      "LIFECYCLE-ARGS",
      "LIFECYCLE-UNMEASURED",
    ],
  );
  t.assert.equal(started.ok, true);
  t.assert.equal(completed.ok, true);
  t.assert.deepEqual(types, [
    "stage.started",
    "stage.started",
    "stage.completed",
  ]);
  t.assert.equal(rows(files).at(-1).parent, rows(files)[1].id);
  t.assert.equal(rows(files).at(-1).duration_ms, 2000);
});

test("unit records take the row risk and a numeric diff against HEAD", async (t) => {
  const files = project({ "intent.md": plan });
  const bad = await command(files, ["unit-started", "U9"]);
  const missing = await command(project({}), ["unit-started", "U1"]);
  const started = await command(files, ["unit-started", "U1"]);
  const noDiff = await command(files, ["unit-completed", "U1"], {
    git: gitOf({}),
  });
  const binary = await command(files, ["unit-completed", "U1"], {
    git: gitOf({ "diff --numstat HEAD": "-\t-\timage\n" }),
  });
  const zero = await command(files, ["unit-completed", "U2"], {
    git: gitOf({ "diff --numstat HEAD": "" }),
  });
  await command(files, ["unit-started", "U2"]);
  const counted = await command(files, ["unit-completed", "U2"], {
    now: "2026-09-30T00:00:11.000Z",
    git: gitOf({
      "diff --numstat HEAD": "3\t1\tsrc/app.js\n\n2\t0\tsrc/more.js\n",
    }),
  });
  const done = rows(files).find((row) => row.type === "unit.completed");
  t.plan(7);
  t.assert.deepEqual(
    [
      ids(bad)[0],
      ids(missing)[0],
      ids(noDiff)[0],
      ids(binary)[0],
      ids(zero)[0],
    ],
    [
      "LIFECYCLE-ARGS",
      "LIFECYCLE-PLAN",
      "LIFECYCLE-UNMEASURED",
      "LIFECYCLE-UNMEASURED",
      "LIFECYCLE-UNMEASURED",
    ],
  );
  t.assert.equal(started.ok, true);
  t.assert.equal(rows(files).find((row) => row.unit === "U1").risk, "L");
  t.assert.equal(counted.ok, true);
  t.assert.deepEqual(
    [done.files_changed, done.lines_changed, done.duration_ms, done.risk],
    [2, 6, 1000, "M"],
  );
  t.assert.equal(isAuditEvent(done), true);
  t.assert.equal(
    done.parent,
    rows(files).find((row) => row.unit === "U2" && row.type === "unit.started")
      .id,
  );
});
