import { test } from "node:test";
import { createIntentAuditStore } from "../../../core/hooks/lib/audit.mjs";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import {
  answerQuestion,
  runQuestion,
} from "../../../core/hooks/lib/question.mjs";
import { isAuditEvent } from "../../../core/hooks/lib/validation.mjs";
import {
  answered,
  asked,
  askedId,
  auditPath,
  card,
  decisions,
  defaulted,
  defaultedId,
  environment,
  git,
  home,
  intent,
  jsonl,
  project,
} from "../../helpers/resume.mjs";

/** @param {import('../../../core/hooks/lib/runtime-contracts.mjs').FileStore} files @param {string[]} args @param {{intent?:string|null,now?:string}} [shape] */
const command = (files, args, shape = {}) =>
  runQuestion(files, environment, git, {
    intent: shape.intent === undefined ? intent : shape.intent,
    args,
    now: () => shape.now ?? "2026-09-30T00:00:00Z",
  });

/** @param {import('../../../core/hooks/lib/runtime-contracts.mjs').DoctorReport} report */
const ids = (report) => report.checks.map((item) => item.id);

/** @param {{data:Map<string,string>}} files */
const rows = (files) =>
  (files.data.get(auditPath) ?? "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test("the question command needs an explicit Intent and exact arguments", async (t) => {
  const files = project({ "decisions.md": decisions(card()) });
  const reports = [
    await command(files, ["ask", "Q-1"], { intent: null }),
    await command(files, []),
    await command(files, ["answer", "Q-1"]),
    await command(files, ["ask", "q-1"]),
    await command(files, ["ask", "Q-1", "extra"]),
  ];
  t.plan(reports.length * 2 + 1);
  for (const [index, report] of reports.entries()) {
    t.assert.equal(report.ok, false);
    t.assert.deepEqual(ids(report), [
      index === 0 ? "QUESTION-SCOPE" : "QUESTION-ARGS",
    ]);
  }
  t.assert.equal(files.data.has(auditPath), false);
});

test("asking records the card's option count and default once, and a resend keeps the first time", async (t) => {
  const files = project({
    "decisions.md": decisions(
      card(),
      card("Q-2", { fallback: "blocking: needs product input." }),
    ),
  });
  const first = await command(files, ["ask", "Q-1"]);
  const again = await command(files, ["ask", "Q-1"], {
    now: "2026-10-01T00:00:00Z",
  });
  const blocking = await command(files, ["ask", "Q-2"]);
  const records = rows(files);
  t.plan(7);
  t.assert.deepEqual([first.ok, again.ok, blocking.ok], [true, true, true]);
  t.assert.deepEqual(ids(first), ["QUESTION-RECORDED"]);
  t.assert.match(first.checks[0]?.detail ?? "", new RegExp(askedId("Q-1")));
  t.assert.equal(records.length, 2);
  t.assert.deepEqual(records[0], asked("Q-1"));
  t.assert.deepEqual(
    records[1],
    asked("Q-2", {
      fallback: "",
      text: card("Q-2", { fallback: "blocking: needs product input." }),
    }),
  );
  t.assert.equal(records.every(isAuditEvent), true);
});

test("asking again after the card changed, missing cards and synthetic records are refused", async (t) => {
  const files = project({ "decisions.md": decisions(card()) });
  await command(files, ["ask", "Q-1"]);
  const before = files.data.get(auditPath);
  files.data.set(
    `${home}/decisions.md`,
    decisions(card("Q-1", { options: ["A", "B", "C"] })),
  );
  const changed = await command(files, ["ask", "Q-1"]);
  const missing = await command(files, ["ask", "Q-9"]);
  const synthetic = project({
    "decisions.md": decisions(card()),
    "audit/events.jsonl": jsonl([{ ...asked("Q-1"), synthetic: true }]),
  });
  const reused = await command(synthetic, ["ask", "Q-1"]);
  t.plan(4);
  t.assert.deepEqual(ids(changed), ["QUESTION-CONFLICT"]);
  t.assert.deepEqual(ids(missing), ["QUESTION-CARD"]);
  t.assert.deepEqual(ids(reused), ["QUESTION-EVIDENCE"]);
  t.assert.equal(files.data.get(auditPath), before);
});

test("a default is recorded from the asked record only while no person answered", async (t) => {
  const question = asked("Q-1");
  const files = project({
    "decisions.md": decisions(card("Q-1", { fallback: "B if unanswered." })),
    "audit/events.jsonl": jsonl([question]),
  });
  const applied = await command(files, ["default", "Q-1"], {
    now: "2026-09-30T00:00:03Z",
  });
  const again = await command(files, ["default", "Q-1"], {
    now: "2026-10-02T00:00:00Z",
  });
  const records = rows(files);
  t.plan(4);
  t.assert.deepEqual([applied.ok, again.ok], [true, true]);
  t.assert.match(
    applied.checks[0]?.detail ?? "",
    new RegExp(defaultedId(question.id)),
  );
  t.assert.equal(records.length, 2);
  t.assert.deepEqual(records[1], defaulted(question));
});

test("defaults are refused before asking, for blocking questions and after an answer", async (t) => {
  const blocking = asked("Q-2", { fallback: "" });
  const question = asked("Q-1");
  const files = project({
    "decisions.md": decisions(card(), card("Q-2"), card("Q-3")),
    "audit/events.jsonl": jsonl([
      question,
      blocking,
      answered(question, "B"),
      { ...asked("Q-3"), synthetic: true },
    ]),
  });
  const before = files.data.get(auditPath);
  const reports = [
    await command(files, ["default", "Q-4"]),
    await command(files, ["default", "Q-2"]),
    await command(files, ["default", "Q-1"]),
    await command(files, ["default", "Q-3"]),
  ];
  t.plan(2);
  t.assert.deepEqual(reports.map(ids), [
    ["QUESTION-UNASKED"],
    ["QUESTION-BLOCKING"],
    ["QUESTION-ANSWERED"],
    ["QUESTION-UNASKED"],
  ]);
  t.assert.equal(files.data.get(auditPath), before);
});

test("a default before its ask's time is refused as unordered evidence", async (t) => {
  const files = project({
    "audit/events.jsonl": jsonl([asked("Q-1", { ts: "2026-10-09T00:00:00Z" })]),
  });
  const result = await command(files, ["default", "Q-1"]);
  t.plan(2);
  t.assert.deepEqual(ids(result), ["QUESTION-EVIDENCE"]);
  t.assert.equal(rows(files).length, 1);
});

test("an unreadable audit log fails the command instead of recording past it", async (t) => {
  const files = project({
    "decisions.md": decisions(card()),
    "audit/events.jsonl": "not json\n",
  });
  t.plan(1);
  await t.assert.rejects(command(files, ["ask", "Q-1"]), /AUDIT-CORRUPT/);
});

/**
 * @param {Record<string,string>} initial @param {'claude'|'codex'} [harness]
 */
function prompt(initial, harness = "claude") {
  const files = project(initial);
  const field = harness === "claude" ? "prompt_id" : "turn_id";
  /** @param {string} text @param {string} [submission] @param {string} [instant] @param {string|null} [scope] */
  const submit = (
    text,
    submission = "answer-1",
    instant = "2026-09-30T00:00:05Z",
    scope = intent,
  ) =>
    answerQuestion(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "s-1",
        cwd: "/project",
        prompt: text,
        ...(submission ? { [field]: submission } : {}),
      },
      {
        projectRoot: "/project",
        harness,
        ...(scope ? { intent: scope } : {}),
        generation: "test",
        now: () => instant,
        newId,
        readText: (path) => files.readText(path),
        locate: (path) => files.locate(path),
        audit: createIntentAuditStore(files, intent),
      },
    );
  return { files, submit };
}

/** One answer per question: the identity derives from the asked record. @param {string} parent */
const answerId = (parent) =>
  newId(intent, JSON.stringify(["question.answered", intent, parent]));

test("a person's explicit answer is recorded against the asked question and is not a confirmation or approval", async (t) => {
  const question = asked("Q-1");
  for (const harness of /** @type {const} */ (["claude", "codex"])) {
    const { submit } = prompt(
      {
        "decisions.md": decisions(card()),
        "audit/events.jsonl": jsonl([question]),
      },
      harness,
    );
    const result = await submit("vouch answer Q-1 B");
    t.assert.equal(result?.decision, "deny");
    t.assert.match(
      /** @type {{reason:string}} */ (result).reason,
      /^VOUCH-ANSWER-RECORDED: .*Q-1 = B/,
    );
    t.assert.deepEqual(result?.events, [
      {
        id: answerId(question.id),
        v: 1,
        type: "question.answered",
        ts: "2026-09-30T00:00:05Z",
        actor: "human",
        harness,
        intent,
        session: "s-1",
        question: "Q-1",
        choice: "B",
        parent: question.id,
        wait_ms: 5000,
      },
    ]);
    t.assert.equal("approve" in /** @type {object} */ (result), false);
  }
});

test("answers after a default are kept, but a second answer, unknown choices and unasked questions are refused", async (t) => {
  const question = asked("Q-1");
  const other = asked("Q-2");
  const { files, submit } = prompt({
    "decisions.md": decisions(card(), card("Q-2"), card("Q-3")),
    "audit/events.jsonl": jsonl([
      question,
      defaulted(question),
      other,
      answered(other, "A"),
      { ...asked("Q-3"), synthetic: true },
    ]),
  });
  const kept = await submit("vouch answer Q-1 B");
  const cases = [
    ["vouch answer Q-2 B", "VOUCH-ANSWER-EXISTS"],
    ["vouch answer Q-1 C", "VOUCH-ANSWER-CHOICE"],
    ["vouch answer Q-3 A", "VOUCH-ANSWER-QUESTION"],
    ["vouch answer Q-9 A", "VOUCH-ANSWER-QUESTION"],
  ];
  t.plan(2 + cases.length);
  t.assert.match(
    /** @type {{reason:string}} */ (kept).reason,
    /VOUCH-ANSWER-RECORDED/,
  );
  t.assert.equal(files.data.has(auditPath), true);
  for (const [text = "", code] of cases)
    t.assert.match(
      /** @type {{reason:string}} */ (await submit(text, `other-${text}`))
        .reason,
      new RegExp(`^${code}`),
    );
});

test("answer input is exact, needs an identity and passes other prompts through", async (t) => {
  const { submit } = prompt({
    "decisions.md": decisions(card()),
    "audit/events.jsonl": jsonl([asked("Q-1")]),
  });
  const invalid = [
    "vouch answer",
    "vouch answer Q-1",
    "vouch answer q-1 A",
    "vouch answer Q-1 A extra",
    "vouch answer Q-1 a",
    "vouch answer Q-1 A\n",
  ];
  t.plan(invalid.length + 5);
  for (const text of invalid)
    t.assert.match(
      /** @type {{reason:string}} */ (await submit(text)).reason,
      /^VOUCH-ANSWER-COMMAND/,
      JSON.stringify(text),
    );
  t.assert.match(
    /** @type {{reason:string}} */ (await submit("vouch answer Q-1 A", ""))
      .reason,
    /^VOUCH-ANSWER-IDENTITY/,
  );
  t.assert.equal(await submit("vouch answers are great"), null);
  t.assert.equal(await submit("please vouch answer Q-1 A"), null);
  t.assert.equal(
    await submit("vouch answer Q-1 A", "x", undefined, null),
    null,
    "no configured Intent: nothing to record",
  );
  t.assert.equal(
    await answerQuestion(
      {
        hook_event_name: "Stop",
        session_id: "s",
        cwd: "/",
        stop_hook_active: false,
      },
      /** @type {never} */ ({ intent }),
    ),
    null,
  );
});

test("a resent answer keeps its first record and time", async (t) => {
  const { files, submit } = prompt({
    "decisions.md": decisions(card()),
    "audit/events.jsonl": jsonl([asked("Q-1")]),
  });
  const first = await submit("vouch answer Q-1 A");
  await files.updateText(
    auditPath,
    (before) => `${before ?? ""}${JSON.stringify(first?.events?.[0])}\n`,
  );
  const again = await submit(
    "vouch answer Q-1 A",
    "answer-1",
    "2026-10-03T00:00:00Z",
  );
  t.plan(2);
  t.assert.deepEqual(again?.events, first?.events);
  t.assert.match(
    /** @type {{reason:string}} */ (again).reason,
    /VOUCH-ANSWER-RECORDED/,
  );
});

test("a card changed after its ask cannot be re-asked or answered under the same Q-n", async (t) => {
  const swapped = decisions(card("Q-1", { options: ["B", "A"] }));
  const { files, submit } = prompt({
    "decisions.md": swapped,
    "audit/events.jsonl": jsonl([asked("Q-1")]),
  });
  const before = files.data.get(auditPath);
  t.plan(3);
  t.assert.match(
    /** @type {{reason:string}} */ (await submit("vouch answer Q-1 A")).reason,
    /^VOUCH-ANSWER-CHANGED/,
  );
  t.assert.deepEqual(ids(await command(files, ["ask", "Q-1"])), [
    "QUESTION-CONFLICT",
  ]);
  t.assert.equal(files.data.get(auditPath), before);
});

test("the card digest ignores the answer section, which is filled after answering", async (t) => {
  const answeredCard = card().replace(
    "Unanswered.",
    "A, from the person on 2026-09-30.",
  );
  const { submit } = prompt({
    "decisions.md": decisions(answeredCard),
    "audit/events.jsonl": jsonl([asked("Q-1")]),
  });
  t.plan(1);
  t.assert.match(
    /** @type {{reason:string}} */ (await submit("vouch answer Q-1 A")).reason,
    /^VOUCH-ANSWER-RECORDED/,
  );
});

test("concurrent different answers share one identity, so the store refuses the second", async (t) => {
  const { files, submit } = prompt({
    "decisions.md": decisions(card()),
    "audit/events.jsonl": jsonl([asked("Q-1")]),
  });
  const first = await submit("vouch answer Q-1 A", "alice");
  const second = await submit("vouch answer Q-1 B", "bob");
  const store = createIntentAuditStore(files, intent);
  await store.append(first?.events ?? []);
  t.plan(3);
  t.assert.equal(first?.events?.[0]?.id, second?.events?.[0]?.id);
  await t.assert.rejects(store.append(second?.events ?? []), /AUDIT-CONFLICT/);
  t.assert.equal(
    rows(files).filter((r) => r.type === "question.answered").length,
    1,
  );
});
