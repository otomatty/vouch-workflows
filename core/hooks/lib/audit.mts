import { isAuditEvent } from "./validation.mjs";

/** @returns Canonical JSON for key-order-independent equality. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function records(
  text: string | null,
): Map<string, import("./contracts.mjs").AuditEvent> {
  const result = new Map();
  if (!text) return result;
  if (!text.endsWith("\n"))
    throw new Error("AUDIT-CORRUPT: missing final newline");
  for (const line of text.slice(0, -1).split("\n")) {
    let event: unknown;
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

export const scanAudit: import("./runtime-contracts.mjs").ScanAudit = (
  text,
) => {
  const scan: import("./runtime-contracts.mjs").AuditScan = {
    events: [],
    invalid: [],
    duplicates: [],
  };
  if (!text) return scan;
  const lines = text.split("\n");
  const ids = new Set();
  // The element after a final newline is empty; any other last element lacks its newline.
  lines.forEach((line, index) => {
    if (index === lines.length - 1 && line === "") return;
    let event: unknown;
    try {
      event = index === lines.length - 1 ? undefined : JSON.parse(line);
    } catch {
      event = undefined;
    }
    if (!isAuditEvent(event)) scan.invalid.push(index + 1);
    else if (ids.has(event.id)) scan.duplicates.push(event.id);
    else {
      ids.add(event.id);
      scan.events.push(event);
    }
  });
  return scan;
};

/** The v2 provenance of a migrated record; empty for any other record. */
export const migratedOrigin = (
  event: import("./contracts.mjs").AuditEvent,
): import("./contracts.mjs").MigratedOrigin =>
  "original_type" in event ? event : {};

export function intentHome(intent: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(intent))
    throw new Error("AUDIT-SCOPE: invalid configured intent");
  return `vouch/intents/${intent}`;
}

export function createIntentAuditStore(
  files: import("./runtime-contracts.mjs").FileStore,
  intent: string,
) {
  return createAuditStore(files, `${intentHome(intent)}/audit/events.jsonl`);
}

export async function findEvent(
  store: import("./contracts.mjs").AuditStore | undefined,
  id: string,
) {
  if (!store?.find)
    throw new Error("AUDIT-MISSING: session recording requires lookup");
  return store.find(id);
}

export async function listEvents(
  store: import("./contracts.mjs").AuditStore | undefined,
) {
  if (!store?.list)
    throw new Error("AUDIT-MISSING: approval evidence requires a listing");
  return store.list();
}

/** Append-only logical log, atomically replaced by FileStore. No partial batches. @param path Explicit installation-owned destination. */
export function createAuditStore(
  files: import("./runtime-contracts.mjs").FileStore,
  path: string,
): import("./runtime-contracts.mjs").AuditStore & {
  find: (
    id: string,
  ) => Promise<import("./contracts.mjs").AuditEvent | undefined>;
  list: () => Promise<import("./contracts.mjs").AuditEvent[]>;
} {
  let snapshot:
    | {
        text: string | null;
        events: Map<string, import("./contracts.mjs").AuditEvent>;
      }
    | undefined;
  function validated(text: string | null) {
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
