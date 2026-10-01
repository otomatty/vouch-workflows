import { test } from "node:test";
import {
  recordAsideAnswer,
  recordAsk,
} from "../../../core/hooks/lib/aside.mjs";
import { createIntentAuditStore } from "../../../core/hooks/lib/audit.mjs";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import { isAuditEvent } from "../../../core/hooks/lib/validation.mjs";
import operations from "../../../core/registry/operations.json" with {
  type: "json",
};
import { auditPath, intent, jsonl, project } from "../../helpers/resume.mjs";

/** @param {'claude'|'codex'} harness @param {string|null} [scope] @param {Record<string,string>} [initial] */
function box(harness = "claude", scope = intent, initial = {}) {
  const files = project(initial);
  const field = harness === "claude" ? "prompt_id" : "turn_id";
  /** @param {string} instant */
  const ctx = (instant) => ({
    projectRoot: "/project",
    harness,
    ...(scope ? { intent: scope } : {}),
    generation: "test",
    now: () => instant,
    newId,
    readText: (/** @type {string} */ path) => files.readText(path),
    locate: (/** @type {string} */ path) => files.locate(path),
    audit: createIntentAuditStore(files, intent),
  });
  /** @param {string} prompt @param {string} [submission] @param {string} [instant] */
  const ask = (
    prompt,
    submission = "ask-1",
    instant = "2026-09-30T00:00:00Z",
  ) =>
    recordAsk(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "s-1",
        cwd: "/project",
        prompt,
        ...(submission ? { [field]: submission } : {}),
      },
      ctx(instant),
    );
  /** @param {string} [submission] @param {string|undefined} [message] @param {string} [instant] */
  const stop = (
    submission = "ask-1",
    message = "The cache is rebuilt on boot.",
    instant = "2026-09-30T00:00:04.250Z",
  ) =>
    recordAsideAnswer(
      {
        hook_event_name: "Stop",
        session_id: "s-1",
        cwd: "/project",
        stop_hook_active: false,
        ...(submission ? { [field]: submission } : {}),
        ...(message === undefined ? {} : { last_assistant_message: message }),
      },
      ctx(instant),
    );
  /** @param {import('../../../core/hooks/lib/contracts.mjs').AuditEvent[]} [events] */
  const append = async (events = []) => {
    if (events.length)
      await createIntentAuditStore(files, intent).append(events);
  };
  return { files, ask, stop, append, field };
}

/** @param {'claude'|'codex'} harness @param {string} submission */
const askId = (harness, submission) =>
  newId(
    "s-1",
    JSON.stringify([
      "aside.asked",
      harness,
      intent,
      harness === "claude" ? "prompt_id" : "turn_id",
      submission,
    ]),
  );

test("an explicit ask is recorded as the person's aside and still reaches the model", async (t) => {
  t.plan(8);
  for (const harness of /** @type {const} */ (["claude", "codex"])) {
    const { ask } = box(harness);
    const prefix = harness === "claude" ? "/vouch ask" : "$vouch ask";
    const result = await ask(`${prefix}  Why is the cache rebuilt?  `);
    t.assert.equal(result?.decision, "allow");
    t.assert.equal("context" in /** @type {object} */ (result), false);
    t.assert.deepEqual(result?.events, [
      {
        id: askId(harness, "ask-1"),
        v: 1,
        type: "aside.asked",
        ts: "2026-09-30T00:00:00Z",
        actor: "human",
        harness,
        intent,
        session: "s-1",
        question: "Why is the cache rebuilt?",
      },
    ]);
    t.assert.equal(result?.events?.every(isAuditEvent), true);
  }
});

test("ask input needs a question and an identity; other prompts and unscoped sessions pass through", async (t) => {
  const { ask } = box();
  const long = "x".repeat(operations.ask.questionChars + 10);
  const bounded = await ask(`/vouch ask ${long}`);
  t.plan(7);
  t.assert.match(
    /** @type {{reason:string}} */ (await ask("/vouch ask")).reason,
    /^VOUCH-ASK-COMMAND/,
  );
  t.assert.match(
    /** @type {{reason:string}} */ (await ask("$vouch ask   ")).reason,
    /^VOUCH-ASK-COMMAND/,
  );
  t.assert.match(
    /** @type {{reason:string}} */ (await ask("/vouch ask why?", "")).reason,
    /^VOUCH-ASK-IDENTITY/,
  );
  t.assert.equal(await ask("/vouch asking"), null);
  t.assert.equal(await ask("please /vouch ask why?"), null);
  t.assert.equal(await box("claude", null).ask("/vouch ask why?"), null);
  t.assert.equal(
    String(bounded?.events?.[0]?.question).length,
    operations.ask.questionChars,
  );
});

test("a resent ask keeps the first time", async (t) => {
  const { ask, append } = box();
  const first = await ask("/vouch ask why?");
  await append(first?.events);
  const again = await ask("/vouch ask why?", "ask-1", "2026-10-01T00:00:00Z");
  t.plan(1);
  t.assert.deepEqual(again?.events, first?.events);
});

test("the Stop of the asking turn records the answer with its duration and bounded final message", async (t) => {
  t.plan(6);
  for (const harness of /** @type {const} */ (["claude", "codex"])) {
    const { ask, stop, append } = box(harness);
    const question =
      /** @type {import('../../../core/hooks/lib/contracts.mjs').AsideAsked} */ (
        (await ask("/vouch ask why?"))?.events?.[0]
      );
    await append([question]);
    const result = await stop();
    t.assert.deepEqual(result, {
      decision: "allow",
      events: [
        {
          id: newId("s-1", JSON.stringify(["aside.answered", question.id])),
          v: 1,
          type: "aside.answered",
          ts: "2026-09-30T00:00:04.250Z",
          actor: "model",
          harness,
          intent,
          session: "s-1",
          question: "why?",
          parent: question.id,
          duration_ms: 4250,
          answer: "The cache is rebuilt on boot.",
        },
      ],
    });
    t.assert.equal(result.events?.every(isAuditEvent), true);
    const long = await stop(
      "ask-1",
      "y".repeat(operations.ask.answerChars + 5),
    );
    t.assert.equal(
      String(/** @type {{answer?:string}} */ long.events?.[0]?.answer).length,
      operations.ask.answerChars,
    );
  }
});

test("Stop never blocks and records nothing for other turns, recorded answers or unusable times", async (t) => {
  const { ask, stop, append, files } = box();
  const question = (await ask("/vouch ask why?"))?.events ?? [];
  await append(question);
  const answer = (await stop())?.events ?? [];
  const results = [
    await stop("other-turn"),
    await stop(""),
    await stop("ask-1", "", "2026-09-29T00:00:00Z"),
    await box("claude", null).stop(),
    await recordAsideAnswer(
      {
        hook_event_name: "SessionStart",
        session_id: "s-1",
        cwd: "/",
        source: "startup",
      },
      /** @type {never} */ ({ intent }),
    ),
  ];
  const withoutMessage = await stop("ask-1", undefined);
  await append(answer);
  const replay = await stop();
  const synthetic = box("claude", intent, {
    [auditPath]: jsonl([{ ...question[0], synthetic: true }]),
  });
  t.plan(results.length + 4);
  for (const result of results)
    t.assert.deepEqual(result, { decision: "allow" });
  t.assert.equal(
    "answer" in (withoutMessage.events?.[0] ?? { answer: "missing" }),
    false,
  );
  t.assert.deepEqual(replay, { decision: "allow" });
  t.assert.deepEqual(await synthetic.stop(), { decision: "allow" });
  t.assert.equal(
    (files.data.get(auditPath) ?? "").trim().split("\n").length,
    2,
  );
});
