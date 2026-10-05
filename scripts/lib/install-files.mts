import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** Paths seen as real directories, or as not yet existing, during one locked operation.
 * The operation creates what was missing itself; races with other writers are not prevented. */
let verified: Set<string> | null = null;

/** Every setup read/write rejects links, including existing ancestors. */
function inspectPath(path: string) {
  if (verified?.has(path)) return;
  const parent = dirname(path);
  if (parent !== path) inspectPath(parent);
  let stat: import("node:fs").Stats;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    verified?.add(path);
    return;
  }
  if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1))
    throw new Error(`INSTALL-LINK: ${path}`);
  if (stat.isDirectory()) verified?.add(path);
}

export function inside(root: string, path: string) {
  const target = resolve(root, path);
  const part = relative(root, target);
  if (
    !part ||
    isAbsolute(part) ||
    part === ".." ||
    part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  )
    throw new Error(`INSTALL-PATH: ${path}`);
  inspectPath(target);
  return target;
}

export function read(path: string): string | null {
  inspectPath(path);
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isFile()) throw new Error(`INSTALL-TYPE: ${path}`);
  const bytes = readFileSync(path);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!Buffer.from(text).equals(bytes))
    throw new Error(`INSTALL-ENCODING: ${path}`);
  return text;
}

export function files(path: string): Record<string, string> {
  inspectPath(path);
  if (!existsSync(path) || !lstatSync(path).isDirectory())
    throw new Error(`INSTALL-SOURCE: ${path}`);
  const result: Record<string, string> = {};
  for (const entry of readdirSync(path, {
    recursive: true,
    withFileTypes: true,
  })) {
    const at = join(entry.parentPath, entry.name);
    inspectPath(at);
    if (entry.isFile())
      result[relative(path, at).replaceAll("\\", "/")] = read(at) as string;
  }
  return result;
}

export type Change = {
  path: string;
  before: string | null;
  after: string | null;
};
export function commitChanges(changes: Change[]) {
  for (const change of changes)
    if (read(change.path) !== change.before)
      throw new Error(`INSTALL-CONFLICT: ${change.path}`);
  const completed: Change[] = [];
  try {
    for (const change of changes) {
      if (read(change.path) !== change.before)
        throw new Error(`INSTALL-CONFLICT: ${change.path}`);
      write(change.path, change.after);
      completed.push(change);
    }
  } catch (error) {
    for (const change of completed.reverse())
      if (read(change.path) === change.after) write(change.path, change.before);
    throw error;
  }
}

function write(path: string, text: string | null) {
  inspectPath(path);
  if (text === null) return rmSync(path, { force: true });
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.vouch-install-${process.pid}`;
  let created = false;
  try {
    writeFileSync(temporary, text, {
      flag: "wx",
      mode: existsSync(path) ? lstatSync(path).mode & 0o777 : 0o600,
    });
    created = true;
    renameSync(temporary, path);
  } finally {
    if (created) rmSync(temporary, { force: true });
  }
}

/** @template T */
export function withLock<T>(root: string, operation: () => T): T {
  inspectPath(root);
  mkdirSync(root, { recursive: true });
  const lock = inside(root, ".vouch/install.lock");
  mkdirSync(dirname(lock), { recursive: true });
  try {
    mkdirSync(lock);
  } catch {
    throw new Error("INSTALL-LOCK: another installer owns this scope");
  }
  const outer = verified === null;
  if (outer) verified = new Set();
  try {
    return operation();
  } finally {
    if (outer) verified = null;
    rmSync(lock, { recursive: true });
  }
}
