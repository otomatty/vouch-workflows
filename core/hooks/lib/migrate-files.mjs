import migration from "../../registry/migration.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import { canonical, scanAudit } from "./audit.mjs";
import { sha256Hex } from "./clock.mjs";

// Migration file boundary (docs/development/migrate.md): source collection, target observation and
// conflicts. Reads only, through the FileStore; links and other nodes are refused, never followed.
/** @typedef {import('./runtime-contracts.mjs').FileStore} FileStore
 * @typedef {import('./migration-contracts.mjs').MigratedFile} MigratedFile
 * @typedef {{path:string,origin:string,scope:'record'|'space',bytes:Buffer,text:string|null}} Source */

/** @param {string[]} items */
export const listed = (items) =>
  items.length > 8
    ? `${items.slice(0, 8).join(", ")} and ${items.length - 8} more`
    : items.join(", ");

/** @param {Uint8Array} bytes @returns {string|null} */
export function decoded(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return null;
  }
}

/** @param {FileStore} files @param {string} path @returns {Promise<Buffer|null|undefined>} undefined: unreadable. */
export async function bytesAt(files, path) {
  try {
    return await files.readBytes(path);
  } catch {
    return undefined;
  }
}

/** @param {FileStore} files @param {string} directory @param {string[]} found @param {string[]} refused */
async function walk(files, directory, found, refused) {
  let entries;
  try {
    entries = await files.list(directory);
  } catch {
    refused.push(directory);
    return;
  }
  for (const entry of entries ?? []) {
    const path = `${directory}/${entry.name}`;
    if (entry.kind === "directory") await walk(files, path, found, refused);
    else if (entry.kind === "file") found.push(path);
    else refused.push(path);
  }
}

/**
 * Every regular file of the record and of the space's codekb / memory, in code-unit path order.
 * @param {FileStore} files @param {string} source @param {string} space
 * @returns {Promise<{sources:Source[],refused:string[],recorded:number}|null>} null: no record directory.
 */
export async function readSources(files, source, space) {
  try {
    if ((await files.list(source)) === null) return null;
  } catch {
    return null;
  }
  /** @type {string[]} */ const found = [];
  /** @type {string[]} */ const refused = [];
  await walk(files, source, found, refused);
  const recorded = found.length;
  for (const directory of migration.source.space)
    await walk(files, `${space}/${directory}`, found, refused);
  /** @type {Source[]} */ const sources = [];
  for (const path of found.sort()) {
    const bytes = await bytesAt(files, path);
    if (!bytes) {
      refused.push(path);
      continue;
    }
    const inRecord = path.startsWith(`${source}/`);
    sources.push({
      path,
      origin: path.slice((inRecord ? source : space).length + 1),
      scope: inRecord ? "record" : "space",
      bytes,
      text: decoded(bytes),
    });
  }
  return { sources, refused, recorded };
}

/** @param {string|null} text @returns {string|null} The single raw frontmatter status, never interpreted. */
function status(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text ?? "")?.[1];
  const values = [...(front ?? "").matchAll(/^status:[ \t]*(.*?)\r?$/gm)];
  return values.length === 1 ? (values[0]?.[1] ?? null) : null;
}

/** @param {FileStore} files @param {string} home @param {string[]} names
 * @returns {Promise<import('./migration-contracts.mjs').ArtifactPresence[]>} */
export async function observeArtifacts(files, home, names) {
  const result = [];
  for (const name of names) {
    const path = `${home}/${name}`;
    const bytes = await bytesAt(files, path);
    result.push({
      path,
      present: bytes !== null,
      status: bytes ? status(decoded(bytes)) : null,
    });
  }
  return result;
}

/**
 * Targets that are neither absent nor identical. Without a report, a folder with Intent documents
 * or another audit record belongs to another Intent.
 * @param {FileStore} files
 * @param {{home:string,migrated:MigratedFile[],events:import('./contracts.mjs').AuditEvent[],artifacts:import('./migration-contracts.mjs').ArtifactPresence[],current:Buffer|null|undefined,brief:Buffer}} plan
 */
export async function findConflicts(files, plan) {
  /** @type {string[]} */ const conflicts = [];
  for (const file of plan.migrated) {
    const existing = await bytesAt(files, file.archive);
    if (
      existing !== null &&
      (existing === undefined || sha256Hex(existing) !== file.sha256)
    )
      conflicts.push(file.archive);
  }
  const path = `${plan.home}/${documents.audit}`;
  let scan;
  try {
    scan = scanAudit(await files.readText(path));
  } catch {
    scan = { events: [], invalid: [0], duplicates: [] };
  }
  if (scan.invalid.length || scan.duplicates.length)
    conflicts.push(`${path}: unreadable, invalid or repeated records`);
  const ours = new Map(plan.events.map((event) => [event.id, event]));
  for (const event of scan.events) {
    const mine = ours.get(event.id);
    if (mine && canonical(mine) !== canonical(event))
      conflicts.push(`${path}: ${event.id} differs`);
  }
  const { current } = plan;
  if (current === undefined || current?.equals(plan.brief) === false)
    conflicts.push(`${plan.home}/${migration.brief}`);
  if (current === null) {
    const occupied = [
      ...plan.artifacts.filter((item) => item.present).map((item) => item.path),
      ...(scan.events.some((event) => !ours.has(event.id)) ? [path] : []),
    ];
    if (occupied.length)
      conflicts.push(
        `${plan.home} belongs to another Intent: ${listed(occupied)}`,
      );
  }
  return conflicts;
}

/** Sources that changed or whose archive copy differs. @param {FileStore} files @param {MigratedFile[]} migrated */
export async function verifyCopies(files, migrated) {
  /** @type {string[]} */ const mismatched = [];
  for (const file of migrated) {
    const source = await bytesAt(files, file.path);
    const copy = await bytesAt(files, file.archive);
    if (
      !source ||
      !copy ||
      sha256Hex(source) !== file.sha256 ||
      sha256Hex(copy) !== file.sha256
    )
      mismatched.push(file.path);
  }
  return mismatched;
}
