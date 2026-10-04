import ledger from "../../registry/audit-events.json" with { type: "json" };
import operations from "../../registry/operations.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import { intentHome, migratedOrigin, scanAudit } from "./audit.mjs";
import { readIntent } from "./env.mjs";
import { sharedWaitIds } from "./measure.mjs";

// Measured audit values only (docs/development/resume.md); nothing is estimated or filled in,
// and migrated estimates (docs/development/migrate.md) are only counted.
// The scan keeps only schema-valid records, so every type has a ledger entry.
export type TypeSummary = import("./runtime-contracts.mjs").TypeSummary;
export type Registered = keyof typeof ledger.events;

const at = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce(
      (item, key) =>
        item !== null && typeof item === "object"
          ? (item as Record<string, unknown>)[key]
          : undefined,
      value,
    );

export const runReport: import("./runtime-contracts.mjs").RunReport = async (
  files,
  _environment,
  _git,
  ports = { intent: readIntent() },
) => {
  const { intent } = ports;
  if (!intent)
    return {
      v: 1,
      ok: false,
      checks: [
        {
          id: "REPORT-SCOPE",
          ok: false,
          detail: "VOUCH_INTENT names no Intent",
        },
      ],
    };
  const path = `${intentHome(intent)}/${documents.audit}`;
  const scan = scanAudit(await files.readText(path));
  const shared = new Set(sharedWaitIds(scan.events));
  const types: Record<string, TypeSummary> = {};
  let legacy = 0;
  for (const event of scan.events) {
    if (event.type.startsWith("legacy.")) {
      legacy++;
      continue;
    }
    const entry = ledger.events[event.type as Registered];
    if (!entry) {
      legacy++;
      continue;
    }
    const summary = types[event.type] ?? {
      count: 0,
      synthetic: 0,
      estimated: 0,
      measures: Object.fromEntries(
        [...entry.measures, ...operations.report.common_measures].map(
          (name) => [
            name,
            { n: 0, sum: 0, min: 0, max: 0, missing: 0, examples: [] },
          ],
        ),
      ),
    };
    types[event.type] = summary;
    summary.count++;
    if (event.synthetic) {
      summary.synthetic++;
      continue;
    }
    // A migrated time or duration derived from neighbouring records is never a measurement.
    if (migratedOrigin(event).estimated) {
      summary.estimated++;
      continue;
    }
    for (const [name, measure] of Object.entries(summary.measures)) {
      if (name === "wait_ms" && shared.has(event.id)) {
        measure.excluded = (measure.excluded ?? 0) + 1;
        continue;
      }
      const value = at(event, name);
      if (typeof value !== "number") {
        measure.missing++;
        continue;
      }
      measure.min = measure.n ? Math.min(measure.min, value) : value;
      measure.max = measure.n ? Math.max(measure.max, value) : value;
      measure.n++;
      measure.sum += value;
      if (measure.examples.length < operations.report.examples)
        measure.examples.push(event.id);
    }
  }
  // A start type pairs with an end type that names its start as parent.
  const ends = new Set(
    scan.events.flatMap((event) =>
      !event.synthetic && event.parent ? [`${event.type} ${event.parent}`] : [],
    ),
  );
  const unpaired: Record<string, string[]> = {};
  for (const event of scan.events) {
    const entry = ledger.events[event.type as Registered];
    if (
      !entry ||
      event.synthetic ||
      !entry.pairs_with.length ||
      entry.fields.required.includes("parent")
    )
      continue;
    if (!entry.pairs_with.some((end) => ends.has(`${end} ${event.id}`)))
      unpaired[event.type] = [...(unpaired[event.type] ?? []), event.id];
  }
  const complete = !scan.invalid.length && !scan.duplicates.length;
  return {
    v: 1,
    ok: complete,
    checks: [
      { id: "REPORT-SCOPE", ok: true, detail: `${intent}: ${path}` },
      {
        id: "REPORT-AUDIT",
        ok: complete,
        detail: complete
          ? `${scan.events.length} readable records; no invalid lines or duplicate IDs`
          : `${scan.events.length} readable records; invalid lines ${scan.invalid.join(", ") || "none"}; duplicate IDs ${scan.duplicates.join(", ") || "none"}`,
      },
    ],
    report: {
      intent,
      path,
      events: scan.events.length,
      invalid: scan.invalid,
      duplicates: scan.duplicates,
      types,
      unpaired,
      legacy,
      shared_waits: [...shared].sort(),
    },
  };
};
