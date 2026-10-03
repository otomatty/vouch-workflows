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

/** @param {string} text */
export const digest = (text) => createHash("sha256").update(text).digest("hex");

/** Every setup read/write rejects links, including existing ancestors.
 * @param {string} path */
function inspectPath(path) {
  const parent = dirname(path);
  if (parent !== path) inspectPath(parent);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1))
    throw new Error(`INSTALL-LINK: ${path}`);
}

/** @param {string} root @param {string} path */
export function inside(root, path) {
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

/** @param {string} path @returns {string|null} */
export function read(path) {
  inspectPath(path);
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isFile()) throw new Error(`INSTALL-TYPE: ${path}`);
  const bytes = readFileSync(path);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!Buffer.from(text).equals(bytes))
    throw new Error(`INSTALL-ENCODING: ${path}`);
  return text;
}

/** @param {string} path @returns {Record<string,string>} */
export function files(path) {
  inspectPath(path);
  if (!existsSync(path) || !lstatSync(path).isDirectory())
    throw new Error(`INSTALL-SOURCE: ${path}`);
  /** @type {Record<string,string>} */ const result = {};
  for (const entry of readdirSync(path, {
    recursive: true,
    withFileTypes: true,
  })) {
    const at = join(entry.parentPath, entry.name);
    inspectPath(at);
    if (entry.isFile())
      result[relative(path, at).replaceAll("\\", "/")] = /** @type {string} */ (
        read(at)
      );
  }
  return result;
}

/** @typedef {{path:string,before:string|null,after:string|null}} Change */
/** @param {Change[]} changes */
export function commitChanges(changes) {
  for (const change of changes)
    if (read(change.path) !== change.before)
      throw new Error(`INSTALL-CONFLICT: ${change.path}`);
  /** @type {Change[]} */ const completed = [];
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

/** @param {string} path @param {string|null} text */
function write(path, text) {
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

/** @template T @param {string} root @param {()=>T} operation @returns {T} */
export function withLock(root, operation) {
  inspectPath(root);
  mkdirSync(root, { recursive: true });
  const lock = inside(root, ".vouch/install.lock");
  mkdirSync(dirname(lock), { recursive: true });
  try {
    mkdirSync(lock);
  } catch {
    throw new Error("INSTALL-LOCK: another installer owns this scope");
  }
  try {
    return operation();
  } finally {
    rmSync(lock, { recursive: true });
  }
}
