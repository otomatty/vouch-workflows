import { test } from "node:test";
import { checkpointContent } from "../../../core/hooks/lib/checkpoints.mjs";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import { readPosition } from "../../../core/hooks/lib/position.mjs";
import { confirmation, evidenced } from "../../helpers/approval.mjs";
import { planned } from "../../helpers/intent-review.mjs";
import {
  answered,
  asked,
  auditPath,
  defaulted,
  home,
  intent,
  jsonl,
  project,
} from "../../helpers/resume.mjs";

const observe = (initial: Record<string, string>) => {
  const files = project(initial);
  return readPosition(
    { readText: (path) => files.readText(path), newId },
    intent,
  );
};

test("an empty project is observed as absent artifacts with an unknown plan and no records", async (t) => {
  const position = await observe({});
  t.plan(1);
  t.assert.deepEqual(position, {
    intent,
    language: "ja",
    artifacts: [
      ["intent", "intent.md"],
      ["design", "design.md"],
      ["build", "build-log.md"],
      ["verify", "review.md"],
    ].map(([stage, name]) => ({
      stage,
      path: `${home}/${name}`,
      present: false,
      status: null,
    })),
    audit: {
      path: auditPath,
      events: 0,
      synthetic: 0,
      invalid: [],
      duplicates: [],
    },
    checkpoints: { state: "unknown", reason: "intent.md is absent" },
    approval: "none",
    unanswered: [],
    defaulted: [],
    uncertain: [],
  });
});

test("declared statuses stay raw and only confirmations of the current content count", async (t) => {
  const draft = planned();
  const content = checkpointContent(
    { checkpoint: "acceptance" },
    { intent: draft, design: null },
  );
  if (!content) throw new Error("no content");
  const confirmed = confirmation({ checkpoint: "acceptance" }, content, {
    intent,
  });
  const position = await observe({
    "intent.md": draft,
    "design.md": "---\nstatus: reviewing\n---\n# Design\n",
    "build-log.md": "# Build log\n",
    "audit/events.jsonl": jsonl([confirmed]),
  });
  const unknown = await observe({
    "intent.md": "---\nstatus: draft\nstatus: approved\n---\n# Plan\n",
    "vouch/rules.md": "---\nlanguage: en\ncheckpoints: everything\n---\n",
  });
  t.plan(5);
  t.assert.deepEqual(
    position.artifacts.map((item) => [item.present, item.status]),
    [
      [true, "draft"],
      [true, "reviewing"],
      [true, null],
      [false, null],
    ],
  );
  t.assert.deepEqual(position.checkpoints, {
    state: "observed",
    required: ["acceptance", "scope", "units"],
    missing: ["scope", "units"],
  });
  t.assert.equal(position.approval, "none");
  t.assert.deepEqual(
    [unknown.language, unknown.artifacts[0]?.status],
    ["en", null],
  );
  t.assert.equal(unknown.checkpoints.state, "unknown");
});

test("approved is evidence only with a matching approval chain; a declaration alone is reported as such", async (t) => {
  const approved = planned().replace("status: draft", "status: approved");
  const { gate, approval } = evidenced(approved, { intent });
  const proven = await observe({
    "intent.md": approved,
    "audit/events.jsonl": jsonl([gate, approval]),
  });
  const declared = await observe({ "intent.md": approved });
  t.plan(2);
  t.assert.equal(proven.approval, "evidence");
  t.assert.equal(declared.approval, "declared");
});

test("questions pair by parent: unanswered, default-applied and uncertain stay apart from human answers", async (t) => {
  const open = asked("Q-1");
  const fallback = asked("Q-2", { fallback: "B" });
  const settled = asked("Q-3");
  const overridden = asked("Q-4");
  const twice = [
    { ...asked("Q-5"), id: "dup-a" },
    { ...asked("Q-5"), id: "dup-b" },
  ];
  const mismatched = { ...answered(open, "A"), id: "wrong", question: "Q-9" };
  const orphan = { ...answered(open, "A"), id: "orphan", parent: "missing" };
  const position = await observe({
    "audit/events.jsonl": jsonl([
      open,
      fallback,
      defaulted(fallback),
      settled,
      answered(settled, "A"),
      overridden,
      defaulted(overridden),
      answered(overridden, "B"),
      ...twice,
      mismatched,
      orphan,
      { ...asked("Q-6"), synthetic: true },
      asked("Q-7", { scope: "other-intent" }),
    ]),
  });
  t.plan(5);
  t.assert.deepEqual(position.unanswered, [
    { question: "Q-1", event: open.id, default: "A" },
    { question: "Q-5", event: "dup-a", default: "A" },
    { question: "Q-5", event: "dup-b", default: "A" },
  ]);
  t.assert.deepEqual(position.defaulted, [
    {
      question: "Q-2",
      event: fallback.id,
      choice: "B",
      defaulted: defaulted(fallback).id,
    },
  ]);
  t.assert.deepEqual(position.uncertain, ["dup-a", "dup-b", "wrong", "orphan"]);
  t.assert.equal(position.audit.synthetic, 1);
  t.assert.equal(position.audit.events, 14);
});

test("a damaged audit log yields a partial observation instead of an error", async (t) => {
  const open = asked("Q-1");
  const position = await observe({
    "audit/events.jsonl": `${JSON.stringify(open)}\n{broken\n`,
  });
  t.plan(2);
  t.assert.deepEqual(position.audit.invalid, [2]);
  t.assert.deepEqual(position.unanswered, [
    { question: "Q-1", event: open.id, default: "A" },
  ]);
});

test("positions refuse an Intent name that could leave the intents folder", async (t) => {
  t.plan(1);
  await t.assert.rejects(
    readPosition({ readText: async () => null, newId }, "../escape"),
    /AUDIT-SCOPE/,
  );
});
