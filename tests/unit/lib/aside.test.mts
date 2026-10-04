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

function box(
  harness: "claude" | "codex" = "claude",
  scope: string | null = intent,
  initial: Record<string, string> = {},
) {
  const files = project(initial);
  const field = harness === "claude" ? "prompt_id" : "turn_id";
  const ctx = (instant: string) => ({
    projectRoot: "/project",
    harness,
    ...(scope ? { intent: scope } : {}),
    generation: "test",
    now: () => instant,
    newId,
    readText: (path: string) => files.readText(path),
    locate: (path: string) => files.locate(path),
    audit: createIntentAuditStore(files, intent),
  });
  const ask = (
    prompt: string,
    submission: string = "ask-1",
    instant: string = "2026-09-30T00:00:00Z",
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
  /** @param message null: no final message. */
  const stop = (
    submission: string = "ask-1",
    message: string | null = "The cache is rebuilt on boot.",
    instant: string = "2026-09-30T00:00:04.250Z",
  ) =>
    recordAsideAnswer(
      {
        hook_event_name: "Stop",
        session_id: "s-1",
        cwd: "/project",
        stop_hook_active: false,
        ...(submission ? { [field]: submission } : {}),
        ...(message === null ? {} : { last_assistant_message: message }),
      },
      ctx(instant),
    );
  const append = async (
    events: import("../../../core/hooks/lib/contracts.mjs").AuditEvent[] = [],
  ) => {
    if (events.length)
      await createIntentAuditStore(files, intent).append(events);
  };
  return { files, ask, stop, append, field };
}

const askId = (harness: "claude" | "codex", submission: string) =>
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
  for (const harness of ["claude", "codex"] as const) {
    const { ask } = box(harness);
    const prefix = harness === "claude" ? "/vouch ask" : "$vouch ask";
    const result = await ask(`${prefix}  Why is the cache rebuilt?  `);
    t.assert.equal(result?.decision, "allow");
    t.assert.equal("context" in (result as object), false);
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
    ((await ask("/vouch ask")) as { reason: string }).reason,
    /^VOUCH-ASK-COMMAND/,
  );
  t.assert.match(
    ((await ask("$vouch ask   ")) as { reason: string }).reason,
    /^VOUCH-ASK-COMMAND/,
  );
  t.assert.match(
    ((await ask("/vouch ask why?", "")) as { reason: string }).reason,
    /^VOUCH-ASK-IDENTITY/,
  );
  t.assert.equal(await ask("/vouch asking"), null);
  t.assert.equal(await ask("please /vouch ask why?"), null);
  t.assert.equal(await box("claude", null).ask("/vouch ask why?"), null);
  const first = bounded?.events?.[0] as { question?: string } | undefined;
  t.assert.equal(String(first?.question).length, operations.ask.questionChars);
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
  for (const harness of ["claude", "codex"] as const) {
    const { ask, stop, append } = box(harness);
    const question = (await ask("/vouch ask why?"))
      ?.events?.[0] as import("../../../core/hooks/lib/contracts.mjs").AsideAsked;
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
    const kept = long.events?.[0] as { answer?: string } | undefined;
    t.assert.equal(String(kept?.answer).length, operations.ask.answerChars);
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
      { intent } as never,
    ),
  ];
  const withoutMessage = await stop("ask-1", null);
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
