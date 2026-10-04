import { newId } from "../../core/hooks/lib/clock.mjs";
import { readQuestionCard } from "../../core/hooks/lib/decisions.mjs";
import { memoryFiles } from "./runtime.mjs";

// Hand-authored inputs for resume, ask, question and report tests. None is captured evidence.
export const intent = "260930-resume";
export const home = `vouch/intents/${intent}`;
export const auditPath = `${home}/audit/events.jsonl`;

/** One decisions.md question card in the template grammar. */
export function card(
  id: string = "Q-1",
  shape: { fallback?: string; options?: string[] } = {},
) {
  const { fallback = "A if unanswered.", options = ["A", "B"] } = shape;
  return [
    `### ${id}: Choice`,
    "",
    "<!-- question:situation -->",
    "We need a choice. src/app.js:1@test",
    "",
    "<!-- question:options -->",
    "| Option <!-- option:option --> | Benefits <!-- option:benefits --> | Drawbacks <!-- option:drawbacks --> | Basis <!-- option:basis --> |",
    "| --- | --- | --- | --- |",
    ...options.map(
      (option) => `| ${option} | Small | Limited | src/app.js:1@test |`,
    ),
    "",
    "<!-- question:recommendation -->",
    "A because it is small.",
    "",
    "<!-- question:default -->",
    fallback,
    "",
    "<!-- question:impact -->",
    "U1 continues.",
    "",
    "<!-- question:answer -->",
    "Unanswered.",
    "",
  ].join("\n");
}

export const decisions = (...cards: string[]) =>
  `# Decisions\n\n<!-- sec:questions -->\n## Questions\n\n${cards.join("\n")}\n<!-- sec:decisions -->\n## Decisions\n`;

export const jsonl = (events: unknown[]) =>
  events.map((event) => `${JSON.stringify(event)}\n`).join("");

/** Derived identities, as the runtime documents them. */
export const askedId = (question: string, scope: string = intent) =>
  newId(scope, JSON.stringify(["question.asked", scope, question]));
export const defaultedId = (parent: string, scope: string = intent) =>
  newId(scope, JSON.stringify(["question.defaulted", scope, parent]));

/** The digest an ask records for a card. */
function cardDigest(text: string, question: string) {
  const read = readQuestionCard(decisions(text), question);
  if ("error" in read) throw new Error(read.error);
  return read.sha256;
}

/** @param shape `text`: the asked card, by default `card(question)`. */
export function asked(
  question: string,
  shape: {
    fallback?: string;
    ts?: string;
    scope?: string;
    options?: number;
    text?: string;
  } = {},
): import("../../core/hooks/lib/contracts.mjs").QuestionAsked {
  const {
    fallback = "A",
    ts = "2026-09-30T00:00:00Z",
    scope = intent,
    options = 2,
    text = card(question),
  } = shape;
  return {
    id: askedId(question, scope),
    v: 1,
    type: "question.asked",
    ts,
    actor: "model",
    intent: scope,
    question,
    options,
    card: { path: "decisions.md", sha256: cardDigest(text, question) },
    ...(fallback ? { blocking: false, default: fallback } : { blocking: true }),
  };
}

export function answered(
  parent: import("../../core/hooks/lib/contracts.mjs").QuestionAsked,
  choice: string,
  shape: { id?: string; ts?: string } = {},
): import("../../core/hooks/lib/contracts.mjs").QuestionAnswered {
  const { id = `answer-${parent.question}`, ts = "2026-09-30T00:00:05Z" } =
    shape;
  return {
    id,
    v: 1,
    type: "question.answered",
    ts,
    actor: "human",
    intent: parent.intent,
    question: parent.question,
    choice,
    parent: parent.id,
    wait_ms: 5000,
  };
}

export function defaulted(
  parent: import("../../core/hooks/lib/contracts.mjs").QuestionAsked,
): import("../../core/hooks/lib/contracts.mjs").QuestionDefaulted {
  return {
    id: defaultedId(parent.id, parent.intent),
    v: 1,
    type: "question.defaulted",
    ts: "2026-09-30T00:00:03Z",
    actor: "model",
    intent: parent.intent,
    question: parent.question,
    choice: parent.default ?? "A",
    parent: parent.id,
    wait_ms: 3000,
  };
}

/** A memory project holding the files given relative to the Intent folder, or absolute keys. */
export function project(initial: Record<string, string> = {}) {
  return memoryFiles(
    Object.fromEntries(
      Object.entries(initial).map(([path, text]) => [
        path.startsWith("vouch/") ? path : `${home}/${path}`,
        text,
      ]),
    ),
  );
}

export const environment = {
  projectRoot: "/project",
  installationRoot: ".claude",
  nodeVersion: "22.19.0",
};
export const git = { ok: true, detail: "git" };
