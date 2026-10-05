import approval from "../../registry/approval.json" with { type: "json" };
import authoring from "../../registry/intent-authoring.json" with {
  type: "json",
};
import stages from "../../registry/stage-authoring.json" with { type: "json" };
import workflow from "../../registry/workflow.json" with { type: "json" };
import { draftText, snapshotIntent } from "./approval.mjs";
import { sha256Hex } from "./clock.mjs";

// Checkpoints and the plan they depend on; see docs/development/approval-boundary.md.
const unitId = new RegExp(approval.plan.unit);
const digest = (
  text: string,
  path: "intent.md" | "design.md" = "intent.md",
): import("./contracts.mjs").CheckpointContent => ({
  path,
  sha256: sha256Hex(Buffer.from(text, "utf8")),
});

/** Line indexes of the unique `<!-- sec:id -->` line up to the next section marker. */
function sectionRange(lines: string[], id: string) {
  const marker = `<!-- sec:${id} -->`;
  const starts = lines.flatMap((line, i) =>
    line.replace(/\r?\n$/, "") === marker ? [i] : [],
  );
  if (starts.length !== 1) return null;
  const start = starts[0] as number;
  const end = lines.findIndex(
    (line, i) => i > start && line.startsWith("<!-- sec:"),
  );
  return { start, end: end < 0 ? lines.length : end };
}

function sectionOf(text: string, id: string) {
  const lines = linesOf(text);
  const range = sectionRange(lines, id);
  return range && lines.slice(range.start, range.end).join("");
}

/** Lines with their line breaks. */
const linesOf = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** Rows of the first table in a section: raw lines for digests, cells for reading. */
export function tableRows(text: string, id: string = approval.plan.section) {
  const plan = sectionOf(text, id);
  return plan === null ? null : tableOf(linesOf(plan));
}

/** Rows of the first table in section lines, with their line index. */
function tableOf(raw: string[]) {
  const lines = raw.map((line) => line.trim());
  const first = lines.findIndex((line) => line.startsWith("|"));
  if (first < 0) return null;
  const end = lines.findIndex((line, i) => i > first && !line.startsWith("|"));
  const table = lines.slice(first, end < 0 ? undefined : end);
  const cells = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim());
  const [, separator = ""] = table;
  if (!/^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(separator)) return null;
  return table.slice(2).map((line, i) => ({
    index: first + 2 + i,
    line: `${raw[first + 2 + i]}`,
    cells: cells(line),
  }));
}

/** The draft design.md without the units table rows of other Units; null unless the row is unique. */
function designUnit(text: string, unit: string) {
  const lines = linesOf(text);
  const range = sectionRange(lines, approval.design_units);
  const rows = range && tableOf(lines.slice(range.start, range.end));
  const own = rows?.filter((row) => row.cells[0] === unit) ?? [];
  if (!range || own.length !== 1) return null;
  const others = new Set(
    rows?.filter((row) => row !== own[0]).map((row) => range.start + row.index),
  );
  return lines.filter((_, i) => !others.has(i)).join("");
}

/** A design.md section; the first registered one also holds every byte no other registered section holds (the title and intro before it, unregistered sections), so section mode covers the whole file. */
function designSection(text: string, id: string) {
  const lines = linesOf(text);
  const own = sectionRange(lines, id);
  if (!own) return null;
  if (id !== stages.design_sections[0])
    return lines.slice(own.start, own.end).join("");
  const others = stages.design_sections
    .filter((other) => other !== id)
    .map((other) => sectionRange(lines, other));
  return lines
    .filter(
      (_, i) =>
        !others.some((range) => range && i >= range.start && i < range.end),
    )
    .join("");
}

const token = (cell: string, tokens: string[]) =>
  tokens.find((name) => new RegExp(`^${name}(?![A-Za-z0-9_-])`).test(cell));

export const readPlan: import("./runtime-contracts.mjs").ReadPlan = (text) => {
  const rows = tableRows(text);
  if (!rows?.length)
    return { error: "a plan table with Unit rows is required" };
  const { required, skipped } = approval.plan.design;
  const units: import("./runtime-contracts.mjs").PlanUnit[] = [];
  for (const { cells } of rows) {
    const [id = "", , , riskCell = "", designCell] = cells;
    if (!unitId.test(id) || units.some((unit) => unit.id === id))
      return { error: `${id || "row"}: a unique Unit ID is required` };
    const risk = token(riskCell, approval.plan.risks) as
      | import("./contracts.mjs").Risk
      | undefined;
    const design = token(designCell ?? "", [skipped, required]);
    if (!risk) return { error: `${id}: risk must start with L, M or H` };
    if (!design)
      return {
        error: `${id}: design must start with ${required} or ${skipped}`,
      };
    if (risk === "H" && design === skipped)
      return { error: `${id}: an H Unit requires Design` };
    units.push({ id, risk, design: design === required });
  }
  const order = approval.plan.risks;
  const risk = order[
    Math.max(...units.map((unit) => order.indexOf(unit.risk)))
  ] as import("./contracts.mjs").Risk;
  return {
    plan: {
      units,
      risk,
      // An H Unit must declare required, so this covers H as well.
      design: units.some((unit) => unit.design),
    },
  };
};

export const readCheckpointMode: import("./runtime-contracts.mjs").ReadCheckpointMode =
  (text) => {
    if (text === null)
      return workflow.defaults
        .checkpoints as import("./runtime-contracts.mjs").CheckpointMode;
    const [first, ...lines] = text.split(/\r?\n/);
    const close = lines.indexOf("---");
    if (first !== "---" || close < 0) return null;
    // Every checkpoints key counts, even empty, so a second or broken line is a conflict.
    const keys = lines
      .slice(0, close)
      .filter((line) => /^checkpoints\s*:/.test(line));
    const mode =
      keys.length === 1
        ? /^checkpoints:\s*(\S+)\s*$/.exec(`${keys[0]}`)?.[1]
        : undefined;
    return mode !== undefined && workflow.checkpoint_modes.includes(mode)
      ? (mode as import("./runtime-contracts.mjs").CheckpointMode)
      : null;
  };

export const requiredCheckpoints: import("./runtime-contracts.mjs").RequiredCheckpoints =
  (mode, plan) => {
    const units: import("./runtime-contracts.mjs").CheckpointTarget[] =
      plan.units.map((unit) => ({
        checkpoint: "unit",
        unit: unit.id,
      }));
    const base: import("./runtime-contracts.mjs").CheckpointTarget[] =
      mode === "topic"
        ? [
            { checkpoint: "acceptance" },
            { checkpoint: "scope" },
            { checkpoint: "units" },
          ]
        : mode === "unit"
          ? [{ checkpoint: "acceptance" }, ...units]
          : authoring.intent_sections.map((section) => ({
              checkpoint: "section" as const,
              section,
            }));
    // Open questions Q2: B confirms Design per Unit, C per heading of design.md as well.
    const designs: import("./runtime-contracts.mjs").CheckpointTarget[] =
      !plan.design
        ? []
        : mode === "unit"
          ? plan.units
              .filter((unit) => unit.design)
              .map((unit) => ({ checkpoint: "design", unit: unit.id }))
          : mode === "section"
            ? stages.design_sections.map((section) => ({
                checkpoint: "design",
                section,
              }))
            : [{ checkpoint: "design" }];
    return [
      ...base,
      ...(plan.risk === "H" && mode !== "unit" ? units : []),
      ...designs,
    ];
  };

export const checkpointContent: import("./runtime-contracts.mjs").CheckpointContentOf =
  (target, texts) => {
    if (target.checkpoint === "design") {
      const draft = texts.design === null ? null : draftText(texts.design);
      const unit = "unit" in target ? target.unit : undefined;
      const section = "section" in target ? target.section : undefined;
      // A record naming both parts is ambiguous and never counts.
      if (!draft || (unit !== undefined && section !== undefined)) return null;
      const part =
        unit !== undefined
          ? designUnit(draft.text, unit)
          : section !== undefined
            ? designSection(draft.text, section)
            : undefined;
      if (part !== undefined)
        return part === null ? null : digest(part, "design.md");
      const snapshot = snapshotIntent(draft.text);
      return (
        snapshot && { path: "design.md", sha256: snapshot.revision.sha256 }
      );
    }
    if (target.checkpoint === "unit") {
      const rows = tableRows(texts.intent)?.filter(
        (row) => row.cells[0] === target.unit,
      );
      return rows?.length === 1
        ? digest((rows[0] as { line: string }).line)
        : null;
    }
    const section =
      target.checkpoint === "section"
        ? target.section
        : approval.topics[target.checkpoint];
    const text = sectionOf(texts.intent, section);
    return text === null ? null : digest(text);
  };

export const describeTarget: import("./runtime-contracts.mjs").DescribeTarget =
  (target) => {
    if (target.checkpoint === "design")
      return "unit" in target
        ? `design unit ${target.unit}`
        : "section" in target
          ? `design section ${target.section}`
          : "design";
    if (target.checkpoint === "unit") return `unit ${target.unit}`;
    if (target.checkpoint === "section") return `section ${target.section}`;
    return target.checkpoint;
  };

export const missingCheckpoints: import("./runtime-contracts.mjs").MissingCheckpoints =
  ({ required, events, intent, texts, newId }) => {
    const confirmed = new Set();
    for (const event of events)
      if (
        event.type === "checkpoint.confirmed" &&
        !event.synthetic &&
        event.intent === intent &&
        event.submission &&
        event.id ===
          newId(
            event.session,
            JSON.stringify([
              event.type,
              event.harness,
              intent,
              event.submission.field,
              event.submission.id,
            ]),
          )
      ) {
        const content = checkpointContent(event, texts);
        if (
          content?.path === event.content.path &&
          content.sha256 === event.content.sha256
        )
          confirmed.add(describeTarget(event));
      }
    return required.filter((target) => !confirmed.has(describeTarget(target)));
  };
