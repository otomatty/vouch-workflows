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
  const fields = (id: string) => {
    const read = readQuestionCard(text, id);
    if ("error" in read) throw new Error(read.error);
    const { sha256, ...rest } = read;
    t.assert.match(sha256, /^[a-f0-9]{64}$/);
    return rest;
  };
  t.plan(6);
  t.assert.deepEqual(fields("Q-1"), { options: ["A", "B"], default: "A" });
  t.assert.deepEqual(fields("Q-2"), { options: ["A", "B"] });
  t.assert.deepEqual(fields("Q-3"), { options: ["A", "B", "C"], default: "B" });
});

test("a card's digest changes with its question and options but not with its answer section", (t) => {
  const sha = (text: string) => {
    const read = readQuestionCard(decisions(text), "Q-1");
    return "error" in read ? read.error : read.sha256;
  };
  t.plan(3);
  t.assert.notEqual(sha(card("Q-1", { options: ["B", "A"] })), sha(card()));
  t.assert.notEqual(sha(card().replace("Small", "Tiny")), sha(card()));
  t.assert.equal(
    sha(card().replace("Unanswered.", "B, from the person.")),
    sha(card()),
  );
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
  for (const [text, id] of cases as [string | null, string][])
    t.assert.equal(
      typeof (readQuestionCard(text, id) as { error?: string }).error,
      "string",
      `${id}: ${text?.slice(-80)}`,
    );
});
