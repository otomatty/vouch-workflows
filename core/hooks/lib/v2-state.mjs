import migration from "../../registry/migration.json" with { type: "json" };
import workflow from "../../registry/workflow.json" with { type: "json" };

// v2 aidlc-state.md reading (docs/development/migrate.md). Observation only: progress never sets a status.
/** @typedef {import('./migration-contracts.mjs').StateRow} StateRow
 * @typedef {import('./migration-contracts.mjs').CheckboxState} CheckboxState
 * @typedef {import('./contracts.mjs').Stage} Stage */

const marks = /** @type {Record<string,CheckboxState>} */ (
  migration.checkboxes
);
const stages = /** @type {Record<string,Stage|null>} */ (migration.stages);

/** @type {import('./migration-contracts.mjs').ReadState} */
export function readState(text) {
  if (text === null)
    return { fields: {}, rows: [], problems: ["aidlc-state.md is missing"] };
  /** @type {Record<string,string>} */ const fields = {};
  /** @type {StateRow[]} */ const rows = [];
  /** @type {string[]} */ const problems = [];
  /** @type {string|null} */ let unit = null;
  text.split(/\r?\n/).forEach((line, index) => {
    const field = /^- \*\*([^*]+)\*\*:[ \t]*(.*?)[ \t]*$/.exec(line);
    if (field?.[1] && !Object.hasOwn(fields, field[1]))
      fields[field[1]] = field[2] ?? "";
    if (/^#{1,3} /.test(line)) unit = null;
    const heading = /^Per unit:[ \t]*(.*?)[ \t]*$/.exec(line);
    if (heading) {
      const name = heading[1] ?? "";
      unit = name && !/^\[.*\]$/.test(name) ? name : null;
      return;
    }
    const row = /^- \[(.)\] ([a-z][a-z0-9-]*)(?:\s|$)/.exec(line);
    if (!row) return;
    const [, mark = "", slug = ""] = row;
    const state = Object.hasOwn(marks, mark) ? marks[mark] : undefined;
    if (!state) problems.push(`line ${index + 1}: unknown checkbox [${mark}]`);
    else if (!Object.hasOwn(stages, slug))
      problems.push(`line ${index + 1}: unknown v2 stage ${slug}`);
    else rows.push({ slug, unit, mark, state, line: index + 1 });
  });
  if (rows.length === 0 && problems.length === 0)
    problems.push("no stage checkboxes");
  return { fields, rows, problems };
}

/** @type {import('./migration-contracts.mjs').ObserveProgress} */
export function observeProgress(rows) {
  return /** @type {Record<Stage,import('./migration-contracts.mjs').StageObservation>} */ (
    Object.fromEntries(
      workflow.stages.map((stage) => {
        const mine = rows.filter((row) => stages[row.slug] === stage);
        const done = mine.filter((row) => row.state !== "skipped");
        const state =
          mine.length === 0
            ? "absent"
            : done.length === 0
              ? "skipped"
              : done.every((row) => row.state === "completed")
                ? "completed"
                : done.every((row) => row.state === "pending")
                  ? "pending"
                  : "active";
        return [
          stage,
          {
            state,
            stages: mine.map(
              (row) =>
                `${row.slug} [${row.mark}]${row.unit === null ? "" : ` (${row.unit})`}`,
            ),
          },
        ];
      }),
    )
  );
}
