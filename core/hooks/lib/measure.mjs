// Measured audit values (docs/development/audit-emission.md). Nothing here estimates a missing number.

/** @param {unknown} value */
const whole = (value) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  Number.isSafeInteger(value);

/**
 * Claude usage when the payload actually carried in/out integers. Any other shape is not obtained.
 * @param {unknown} value @returns {import('./contracts.mjs').Tokens|undefined}
 */
export function readTokens(value) {
  if (value === null || typeof value !== "object") return undefined;
  const tokens = /** @type {Record<string,unknown>} */ (value).tokens;
  if (tokens === undefined) return undefined;
  if (tokens === null || typeof tokens !== "object" || Array.isArray(tokens))
    return undefined;
  const record = /** @type {Record<string,unknown>} */ (tokens);
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
        in: /** @type {number} */ (record.in),
        out: /** @type {number} */ (record.out),
      }
    : {
        in: /** @type {number} */ (record.in),
        out: /** @type {number} */ (record.out),
        cache: /** @type {number} */ (record.cache),
      };
}

/**
 * Tokens copied onto a record. Codex never receives them, even when the payload contains the field.
 * @param {import('./contracts.mjs').Harness} harness
 * @param {{tokens?:import('./contracts.mjs').Tokens}} input
 * @returns {import('./contracts.mjs').Tokens|undefined}
 */
export function claudeTokens(harness, input) {
  return harness === "claude" ? input.tokens : undefined;
}

/** A migrated estimate is not a measurement (docs/development/migrate.md).
 * @param {import('./contracts.mjs').AuditEvent} event */
const measured = (event) =>
  !event.synthetic && !("estimated" in event && event.estimated);

/**
 * Gate answers whose wait is already the wait of an intent.approved on the same parent.
 * Summing both would count one human answer twice.
 * @param {import('./contracts.mjs').AuditEvent[]} events @returns {string[]}
 */
export function sharedWaitIds(events) {
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
