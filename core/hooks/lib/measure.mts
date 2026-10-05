// Measured audit values (docs/development/audit-emission.md). Nothing here estimates a missing number.

const whole = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  Number.isSafeInteger(value);

/** Claude usage when the payload actually carried in/out integers. Any other shape is not obtained. */
export function readTokens(
  value: unknown,
): import("./contracts.mjs").Tokens | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const tokens = (value as Record<string, unknown>).tokens;
  if (tokens === undefined) return undefined;
  if (tokens === null || typeof tokens !== "object" || Array.isArray(tokens))
    return undefined;
  const record = tokens as Record<string, unknown>;
  if (
    !Object.keys(record).every(
      (key) => key === "in" || key === "out" || key === "cache",
    )
  )
    return undefined;
  if (!whole(record.in) || !whole(record.out)) return undefined;
  if (record.cache !== undefined && !whole(record.cache)) return undefined;
  return record.cache === undefined
    ? {
        in: record.in as number,
        out: record.out as number,
      }
    : {
        in: record.in as number,
        out: record.out as number,
        cache: record.cache as number,
      };
}

/** Tokens copied onto a record. Codex never receives them, even when the payload contains the field. */
export function claudeTokens(
  harness: import("./contracts.mjs").Harness,
  input: { tokens?: import("./contracts.mjs").Tokens },
): import("./contracts.mjs").Tokens | undefined {
  return harness === "claude" ? input.tokens : undefined;
}

/** A migrated estimate is not a measurement (docs/development/migrate.md). */
const measured = (event: import("./contracts.mjs").AuditEvent) =>
  !event.synthetic && !("estimated" in event && event.estimated);

/** Gate answers whose wait is already the wait of an intent.approved on the same parent. Summing both would count one human answer twice. */
export function sharedWaitIds(
  events: import("./contracts.mjs").AuditEvent[],
): string[] {
  const adopted = new Set(
    events.flatMap((event) =>
      measured(event) && event.type === "intent.approved" && event.parent
        ? [event.parent]
        : [],
    ),
  );
  return events.flatMap((event) =>
    measured(event) &&
    (event.type === "gate.approved" || event.type === "gate.rejected") &&
    event.parent &&
    adopted.has(event.parent)
      ? [event.id]
      : [],
  );
}
