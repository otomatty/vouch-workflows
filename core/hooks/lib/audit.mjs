import { isAuditEvent } from "./validation.mjs";

/** @param {unknown} value @returns {string} Canonical JSON for key-order-independent equality. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/**
 * Append-only logical log, atomically replaced by FileStore. No partial batches.
 * @param {import('./runtime-contracts.mjs').FileStore} files
 * @param {string} path Explicit installation-owned destination.
 * @returns {import('./runtime-contracts.mjs').AuditStore}
 */
export function createAuditStore(files, path) {
  return {
    async append(events) {
      if (!events.every(isAuditEvent))
        throw new Error("AUDIT-SCHEMA: invalid event");
      if (events.length === 0) return "duplicate";
      const changed = await files.updateText(path, (before) => {
        /** @type {Map<string,string>} */ const known = new Map();
        if (before) {
          if (!before.endsWith("\n"))
            throw new Error("AUDIT-CORRUPT: missing final newline");
          for (const line of before.slice(0, -1).split("\n")) {
            /** @type {unknown} */ let event;
            try {
              event = JSON.parse(line);
            } catch {
              throw new Error("AUDIT-CORRUPT: invalid JSON");
            }
            if (!isAuditEvent(event) || known.has(event.id))
              throw new Error("AUDIT-CORRUPT: invalid or repeated record");
            known.set(event.id, canonical(event));
          }
        }
        let appended = "";
        for (const event of events) {
          const content = canonical(event);
          const existing = known.get(event.id);
          if (existing !== undefined) {
            if (existing !== content)
              throw new Error(
                "AUDIT-CONFLICT: same ID with different contents",
              );
            continue;
          }
          known.set(event.id, content);
          appended += `${JSON.stringify(event)}\n`;
        }
        return appended ? (before ?? "") + appended : null;
      });
      return changed ? "appended" : "duplicate";
    },
  };
}
