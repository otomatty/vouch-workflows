import { test } from "node:test";

const ok = (
  t: import("node:test").TestContext,
  value: unknown,
  message?: string,
) => t.assert.equal(Boolean(value), true, message);

import { inspectKnowledge } from "../../../core/hooks/lib/freshness.mjs";
import { inspectQuestions } from "../../../core/hooks/lib/questions.mjs";
import {
  citation,
  head,
  knowledgeProject as project,
  question,
} from "../../helpers/knowledge.mjs";

test("real question cards require complete fields, two to four options and checked basis references", async (t) => {
  const { ctx } = project();
  const index = (await inspectKnowledge(ctx, head)).index;
  t.assert.deepEqual(await inspectQuestions(question, ctx, head, index), []);
  t.assert.deepEqual(
    await inspectQuestions("### Q-n: Unfilled", ctx, head, index),
    [],
  );
  for (const bad of [
    question.replace("Small", "未記入"),
    question.replace("A if unanswered.", ""),
    question.replaceAll(citation, "No evidence"),
    question.replace("<!-- question:recommendation -->", ""),
    question.replace(`| B | Broad | Complex | ${citation} |`, ""),
    question.replace(
      "<!-- question:default -->",
      "<!-- question:default -->\n<!-- question:default -->",
    ),
  ]) {
    ok(t, (await inspectQuestions(bad, ctx, head, index)).length);
  }
  t.assert.deepEqual(
    await inspectQuestions(
      question.replace(
        "A if unanswered.",
        "blocking: no executable default until U1 contract is decided.",
      ),
      ctx,
      head,
      index,
    ),
    [],
  );
});

test("incomplete real questions and blocking without a reason cannot pass", async (t) => {
  const { ctx } = project();
  const index = (await inspectKnowledge(ctx, head)).index;
  for (const text of [
    "### Q-1: Missing body",
    question.replace("A if unanswered.", "blocking:"),
    question + question,
  ]) {
    t.assert.equal(
      (await inspectQuestions(text, ctx, head, index)).length > 0,
      true,
    );
  }
});
