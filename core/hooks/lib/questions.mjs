import authoring from "../../registry/intent-authoring.json" with {
  type: "json",
};
import { inspectReferences } from "./citation.mjs";
import { filled, section } from "./knowledge.mjs";
/** @typedef {import("./knowledge.mjs").Context} Context
 * @typedef {import("./knowledge.mjs").Index} Index */
/** @param {string} text @param {Context} ctx @param {string|null} head @param {Index|null} index */
export async function inspectQuestions(text, ctx, head, index) {
  /** @type {string[]} */ const errors = [];
  const cards = [
    ...text.matchAll(
      /^### (Q-[1-9]\d*):[^\n]*(?:\n|$)([\s\S]*?)(?=^### |<!-- sec:|$(?![\s\S]))/gm,
    ),
  ];
  const seen = new Set();
  for (const [, id, card = ""] of cards) {
    if (seen.has(id)) errors.push(`duplicate question: ${id}`);
    seen.add(id);
    for (const field of authoring.question_fields.filter((f) => f !== "answer"))
      if (!filled(section(card, `question:${field}`)))
        errors.push(`missing question ${id} ${field}`);
    if (/^blocking:\s*$/.test(section(card, "question:default")))
      errors.push(`missing blocking reason: ${id}`);
    const options = section(card, "question:options")
      .split("\n")
      .filter((l) => l.trim().startsWith("|"));
    const [header = "", separator = "", ...rows] = options;
    if (
      !authoring.option_fields.every((f) =>
        header.includes(`<!-- option:${f} -->`),
      ) ||
      !/^\|[\s:|-]+\|$/.test(separator) ||
      rows.length < authoring.question_options.min ||
      rows.length > authoring.question_options.max
    )
      errors.push(`invalid options: ${id}`);
    for (const row of rows) {
      const cells = row
        .split("|")
        .slice(1, -1)
        .map((s) => s.trim());
      if (cells.length !== 4 || !cells.every(filled))
        errors.push(`incomplete option: ${id}`);
      errors.push(
        ...(await inspectReferences(cells[3] ?? "", ctx, head, index, true)),
      );
    }
    errors.push(
      ...(await inspectReferences(
        section(card, "question:situation"),
        ctx,
        head,
        index,
        true,
      )),
    );
  }
  return errors;
}
