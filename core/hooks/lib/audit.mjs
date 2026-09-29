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

/** @param {string|null} text @returns {Map<string,import('./contracts.mjs').AuditEvent>} */
function records(text) {
  const result = new Map();
  if (!text) return result;
  if (!text.endsWith("\n"))
    throw new Error("AUDIT-CORRUPT: missing final newline");
  for (const line of text.slice(0, -1).split("\n")) {
    /** @type {unknown} */ let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error("AUDIT-CORRUPT: invalid JSON");
    }
    if (!isAuditEvent(event) || result.has(event.id))
      throw new Error("AUDIT-CORRUPT: invalid or repeated record");
    result.set(event.id, event);
  }
  return result;
}

/** @param {import('./runtime-contracts.mjs').FileStore} files @param {string} intent */
export function createIntentAuditStore(files, intent) {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(intent))
    throw new Error("AUDIT-SCOPE: invalid configured intent");
  return createAuditStore(files, `vouch/intents/${intent}/audit/events.jsonl`);
}

/** @param {import('./contracts.mjs').AuditStore|undefined} store @param {string} id */
export async function findEvent(store, id) {
  if (!store?.find)
    throw new Error("AUDIT-MISSING: session recording requires lookup");
  return store.find(id);
}

/** @param {import('./contracts.mjs').AuditStore|undefined} store */
export async function listEvents(store) {
  if (!store?.list)
    throw new Error("AUDIT-MISSING: approval evidence requires a listing");
  return store.list();
}

/**
 * Append-only logical log, atomically replaced by FileStore. No partial batches.
 * @param {import('./runtime-contracts.mjs').FileStore} files
 * @param {string} path Explicit installation-owned destination.
 * @returns {import('./runtime-contracts.mjs').AuditStore & {find:(id:string) => Promise<import('./contracts.mjs').AuditEvent|undefined>,list:() => Promise<import('./contracts.mjs').AuditEvent[]>}}
 */
export function createAuditStore(files, path) {
  /** @type {{text:string|null,events:Map<string,import('./contracts.mjs').AuditEvent>}|undefined} */
  let snapshot;
  /** @param {string|null} text */
  function validated(text) {
    // Always compare the freshly read bytes, including the read under the lock.
    if (snapshot?.text === text) return snapshot.events;
    const events = records(text);
    snapshot = { text, events };
    return events;
  }
  return {
    async find(id) {
      // A caller must never receive a mutable reference into the validated snapshot.
      return structuredClone(validated(await files.readText(path)).get(id));
    },
    async list() {
      return structuredClone([
        ...validated(await files.readText(path)).values(),
      ]);
    },
    async append(events) {
      const batch = structuredClone(events);
      if (!batch.every(isAuditEvent))
        throw new Error("AUDIT-SCHEMA: invalid event");
      if (batch.length === 0) return "duplicate";
      const changed = await files.updateText(path, (before) => {
        // Keep speculative batch entries out of the validated snapshot.
        const known = new Map(validated(before));
        let appended = "";
        for (const event of batch) {
          const existing = known.get(event.id);
          if (existing !== undefined) {
            if (canonical(existing) !== canonical(event))
              throw new Error(
                "AUDIT-CONFLICT: same ID with different contents",
              );
            continue;
          }
          known.set(event.id, event);
          appended += `${JSON.stringify(event)}\n`;
        }
        return appended ? (before ?? "") + appended : null;
      });
      return changed ? "appended" : "duplicate";
    },
  };
}
