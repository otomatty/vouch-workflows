import { test } from "node:test";
import { readQuestionCard } from "../../../core/hooks/lib/decisions.mjs";
import { card, decisions } from "../../helpers/resume.mjs";

test("question cards yield table-ordered option IDs and an option-named default or a blocking reason", (t) => {
  const blocking = card("Q-2", {
    fallback: "blocking: no executable default until U1 is decided.",
  });
  const text = decisions(
    card(),
    blocking,
    card("Q-3", {
      fallback: "未回答時の既定: B（在庫不足は 409）",
      options: ["A: 400", "B: 409", "C: 422"],
    }),
  );
  t.plan(3);
  t.assert.deepEqual(readQuestionCard(text, "Q-1"), {
    options: ["A", "B"],
    default: "A",
  });
  t.assert.deepEqual(readQuestionCard(text, "Q-2"), { options: ["A", "B"] });
  t.assert.deepEqual(readQuestionCard(text, "Q-3"), {
    options: ["A", "B", "C"],
    default: "B",
  });
});

test("question cards that are absent, repeated or incomplete are errors, never guessed", (t) => {
  const cases = [
    [null, "Q-1"],
    [decisions(card()), "Q-2"],
    [decisions(card(), card()), "Q-1"],
    [decisions(card("Q-1", { options: ["A"] })), "Q-1"],
    [decisions(card("Q-1", { options: ["A", "B", "C", "D", "E"] })), "Q-1"],
    [decisions(card("Q-1", { options: ["A", "A"] })), "Q-1"],
    [decisions(card("Q-1", { options: ["Option one", "B"] })), "Q-1"],
    [decisions(card("Q-1", { fallback: "未決定" })), "Q-1"],
    [decisions(card("Q-1", { fallback: "" })), "Q-1"],
    [decisions(card("Q-1", { fallback: "blocking:" })), "Q-1"],
    [decisions(card("Q-1", { fallback: "C if unanswered." })), "Q-1"],
  ];
  t.plan(cases.length);
  for (const [text, id] of /** @type {[string|null,string][]} */ (cases))
    t.assert.equal(
      typeof (
        /** @type {{error?:string}} */ (readQuestionCard(text, id)).error
      ),
      "string",
      `${id}: ${text?.slice(-80)}`,
    );
});
