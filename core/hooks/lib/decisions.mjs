import authoring from "../../registry/intent-authoring.json" with {
  type: "json",
};
import { filled, section } from "./knowledge.mjs";

// The decisions.md card grammar of the templates; meaning and evidence stay with questions.mjs.
const cards =
  /^### (Q-[1-9]\d*):[^\n]*(?:\n|$)([\s\S]*?)(?=^### |<!-- sec:|$(?![\s\S]))/gm;

/** @type {import('./runtime-contracts.mjs').ReadQuestionCard} */
export function readQuestionCard(text, question) {
  if (text === null) return { error: "decisions.md is absent" };
  const found = [...text.matchAll(cards)].filter(([, id]) => id === question);
  if (found.length !== 1)
    return {
      error: `${question}: ${found.length} cards; exactly one required`,
    };
  const card = found[0]?.[2] ?? "";
  const [, , ...rows] = section(card, "question:options")
    .split("\n")
    .filter((line) => line.trim().startsWith("|"));
  const options = rows.map(
    (row) => /^\|\s*([A-Z])(?=[\s:：.|])/.exec(row)?.[1] ?? "",
  );
  const { min, max } = authoring.question_options;
  if (
    options.length < min ||
    options.length > max ||
    options.includes("") ||
    new Set(options).size !== options.length
  )
    return {
      error: `${question}: ${min}-${max} options with unique letter IDs required`,
    };
  const fallback = section(card, "question:default");
  if (/^blocking:\s*\S/.test(fallback)) return { options };
  const named = [...fallback.matchAll(/\b[A-Z]\b/g)]
    .map(([letter]) => letter)
    .find((letter) => options.includes(letter));
  if (!filled(fallback) || !named)
    return {
      error: `${question}: the default must name an option or state "blocking: <reason>"`,
    };
  return { options, default: named };
}
