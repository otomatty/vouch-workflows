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
/** @param {string} text @param {'intent.md'|'design.md'} [path] @returns {import('./contracts.mjs').CheckpointContent} */
const digest = (text, path = "intent.md") => ({
  path,
  sha256: sha256Hex(Buffer.from(text, "utf8")),
});

/** Line indexes of the unique `<!-- sec:id -->` line up to the next section marker.
 * @param {string[]} lines @param {string} id */
function sectionRange(lines, id) {
  const marker = `<!-- sec:${id} -->`;
  const starts = lines.flatMap((line, i) =>
    line.replace(/\r?\n$/, "") === marker ? [i] : [],
  );
  if (starts.length !== 1) return null;
  const start = /** @type {number} */ (starts[0]);
  const end = lines.findIndex(
    (line, i) => i > start && line.startsWith("<!-- sec:"),
  );
  return { start, end: end < 0 ? lines.length : end };
}

/** @param {string} text @param {string} id */
function sectionOf(text, id) {
  const lines = linesOf(text);
  const range = sectionRange(lines, id);
  return range && lines.slice(range.start, range.end).join("");
}

/** Lines with their line breaks. @param {string} text */
const linesOf = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** Rows of the first table in a section: raw lines for digests, cells for reading.
 * @param {string} text @param {string} [id] */
export function tableRows(text, id = approval.plan.section) {
  const plan = sectionOf(text, id);
  return plan === null ? null : tableOf(linesOf(plan));
}

/** Rows of the first table in section lines, with their line index.
 * @param {string[]} raw */
function tableOf(raw) {
  const lines = raw.map((line) => line.trim());
  const first = lines.findIndex((line) => line.startsWith("|"));
  if (first < 0) return null;
  const end = lines.findIndex((line, i) => i > first && !line.startsWith("|"));
  const table = lines.slice(first, end < 0 ? undefined : end);
  const cells = (/** @type {string} */ line) =>
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

/** The draft design.md without the units table rows of other Units; null unless the row is unique.
 * @param {string} text @param {string} unit */
function designUnit(text, unit) {
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

/** @param {string} cell @param {string[]} tokens */
const token = (cell, tokens) =>
  tokens.find((name) => new RegExp(`^${name}(?![A-Za-z0-9_-])`).test(cell));

/** @type {import('./runtime-contracts.mjs').ReadPlan} */
export function readPlan(text) {
  const rows = tableRows(text);
  if (!rows?.length)
    return { error: "a plan table with Unit rows is required" };
  const { required, skipped } = approval.plan.design;
  /** @type {import('./runtime-contracts.mjs').PlanUnit[]} */ const units = [];
  for (const { cells } of rows) {
    const [id = "", , , riskCell = "", designCell] = cells;
    if (!unitId.test(id) || units.some((unit) => unit.id === id))
      return { error: `${id || "row"}: a unique Unit ID is required` };
    const risk = /** @type {import('./contracts.mjs').Risk|undefined} */ (
      token(riskCell, approval.plan.risks)
    );
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
  const risk = /** @type {import('./contracts.mjs').Risk} */ (
    order[Math.max(...units.map((unit) => order.indexOf(unit.risk)))]
  );
  return {
    plan: {
      units,
      risk,
      // An H Unit must declare required, so this covers H as well.
      design: units.some((unit) => unit.design),
    },
  };
}

/** @type {import('./runtime-contracts.mjs').ReadCheckpointMode} */
export function readCheckpointMode(text) {
  if (text === null)
    return /** @type {import('./runtime-contracts.mjs').CheckpointMode} */ (
      workflow.defaults.checkpoints
    );
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
    ? /** @type {import('./runtime-contracts.mjs').CheckpointMode} */ (mode)
    : null;
}

/** @type {import('./runtime-contracts.mjs').RequiredCheckpoints} */
export function requiredCheckpoints(mode, plan) {
  /** @type {import('./runtime-contracts.mjs').CheckpointTarget[]} */
  const units = plan.units.map((unit) => ({
    checkpoint: "unit",
    unit: unit.id,
  }));
  /** @type {import('./runtime-contracts.mjs').CheckpointTarget[]} */
  const base =
    mode === "topic"
      ? [
          { checkpoint: "acceptance" },
          { checkpoint: "scope" },
          { checkpoint: "units" },
        ]
      : mode === "unit"
        ? [{ checkpoint: "acceptance" }, ...units]
        : authoring.intent_sections.map((section) => ({
            checkpoint: /** @type {const} */ ("section"),
            section,
          }));
  // Open questions Q2: B confirms Design per Unit, C per heading of design.md as well.
  /** @type {import('./runtime-contracts.mjs').CheckpointTarget[]} */
  const designs = !plan.design
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
}

/** @type {import('./runtime-contracts.mjs').CheckpointContentOf} */
export function checkpointContent(target, texts) {
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
          ? sectionOf(draft.text, section)
          : undefined;
    if (part !== undefined)
      return part === null ? null : digest(part, "design.md");
    const snapshot = snapshotIntent(draft.text);
    return snapshot && { path: "design.md", sha256: snapshot.revision.sha256 };
  }
  if (target.checkpoint === "unit") {
    const rows = tableRows(texts.intent)?.filter(
      (row) => row.cells[0] === target.unit,
    );
    return rows?.length === 1
      ? digest(/** @type {{line:string}} */ (rows[0]).line)
      : null;
  }
  const section =
    target.checkpoint === "section"
      ? target.section
      : approval.topics[target.checkpoint];
  const text = sectionOf(texts.intent, section);
  return text === null ? null : digest(text);
}

/** @type {import('./runtime-contracts.mjs').DescribeTarget} */
export function describeTarget(target) {
  if (target.checkpoint === "design")
    return "unit" in target
      ? `design unit ${target.unit}`
      : "section" in target
        ? `design section ${target.section}`
        : "design";
  if (target.checkpoint === "unit") return `unit ${target.unit}`;
  if (target.checkpoint === "section") return `section ${target.section}`;
  return target.checkpoint;
}

/** @type {import('./runtime-contracts.mjs').MissingCheckpoints} */
export function missingCheckpoints({ required, events, intent, texts, newId }) {
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
}
