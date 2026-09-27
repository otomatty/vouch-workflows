import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = fileURLToPath(new URL("../", import.meta.url));
let output = resolve(source, "dist");
let check = false;
const args = process.argv.slice(2);
const seen = new Set();
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (seen.has(arg)) throw new Error("PACKAGE-ARGS: duplicate option");
  seen.add(arg);
  if (arg === "--check") check = true;
  else if (arg === "--out" && args[i + 1] && !args[i + 1]?.startsWith("--"))
    output = resolve(args[++i] ?? "");
  else throw new Error("PACKAGE-ARGS: use [--check] [--out directory]");
}

/** Reject links, including existing ancestors of a not-yet-created destination.
 * @param {string} path
 */
function unlinked(path) {
  for (let current = path; ; current = dirname(current)) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
    if (stat && (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)))
      throw new Error(`PACKAGE-LINK: ${current}`);
    if (current === dirname(current)) return;
  }
}

/** @param {string} path @returns {string[]} */
function files(path) {
  unlinked(path);
  if (!existsSync(path)) return [];
  const stat = lstatSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) throw new Error(`PACKAGE-TYPE: ${path}`);
  return readdirSync(path)
    .sort()
    .flatMap((name) => files(resolve(path, name)));
}

/** @param {string} root @param {string} path */
function inside(root, path) {
  const child = resolve(root, path);
  const rel = relative(root, child);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`PACKAGE-PATH: ${path}`);
  return child;
}

/** @type {Map<string,Buffer>} */
const expected = new Map();
const manifests = readdirSync(resolve(source, "harness"))
  .sort()
  .filter((name) =>
    existsSync(resolve(source, "harness", name, "manifest.mjs")),
  );
if (manifests.length === 0) throw new Error("PACKAGE-MISSING: no manifests");
for (const name of manifests) {
  const manifestPath = resolve(source, "harness", name, "manifest.mjs");
  unlinked(manifestPath);
  /** @type {{default:{files:{from:string,to:string}[]}}} */
  const { default: manifest } = await import(pathToFileURL(manifestPath).href);
  for (const mapping of manifest.files) {
    if (!/^(core|harness)\//.test(mapping.from))
      throw new Error("PACKAGE-SOURCE: only core and harness");
    const from = inside(source, mapping.from);
    const to = inside(inside(output, name), mapping.to);
    if (!existsSync(from)) throw new Error(`PACKAGE-MISSING: ${mapping.from}`);
    for (const file of files(from)) {
      const target = resolve(to, relative(from, file));
      if (expected.has(target)) throw new Error(`PACKAGE-DUPLICATE: ${target}`);
      expected.set(target, readFileSync(file));
    }
  }
}
const existing = files(output);
const extra = existing.filter((path) => !expected.has(path));
if (extra.length) throw new Error(`PACKAGE-EXTRA: ${extra.join(", ")}`);
for (const path of expected.keys()) unlinked(path);
if (check) {
  for (const [path, bytes] of expected) {
    if (!existsSync(path) || !readFileSync(path).equals(bytes))
      throw new Error(`PACKAGE-DIFF: ${path}`);
  }
} else {
  for (const [path, bytes] of expected) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
}
console.log(
  `Package ${check ? "checked" : "generated"}: ${expected.size} files (${manifests.join(", ")}).`,
);
