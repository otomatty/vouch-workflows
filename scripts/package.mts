/** Distribution data; replacements apply only to Markdown, without harness branches. A render converts each mapped file after replacement, e.g. an agent to TOML. */
export type Render = (name: string, text: string) => [string, string];
export type PackageManifest = {
  files: { from: string; to: string; render?: Render }[];
  tokens?: Record<string, string>;
};

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

/** One synchronous preflight snapshot; reset before checking every destination. */
const inspected: Map<string, import("node:fs").Stats | undefined> = new Map();

function unlinked(path: string): import("node:fs").Stats | undefined {
  if (inspected.has(path)) return inspected.get(path);
  const parent = dirname(path);
  if (parent !== path) unlinked(parent);
  let stat: import("node:fs").Stats | undefined;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  if (stat && (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)))
    throw new Error(`PACKAGE-LINK: ${path}`);
  inspected.set(path, stat);
  return stat;
}

function files(path: string): string[] {
  const stat = unlinked(path);
  if (!stat) return [];
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) throw new Error(`PACKAGE-TYPE: ${path}`);
  return readdirSync(path)
    .sort()
    .flatMap((name) => files(resolve(path, name)));
}

function inside(root: string, path: string) {
  const child = resolve(root, path);
  const rel = relative(root, child);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`PACKAGE-PATH: ${path}`);
  return child;
}

const expected: Map<string, Buffer> = new Map();
const manifests = readdirSync(resolve(source, "harness"))
  .sort()
  .filter((name) =>
    existsSync(resolve(source, "harness", name, "manifest.mjs")),
  );
if (manifests.length === 0) throw new Error("PACKAGE-MISSING: no manifests");
for (const name of manifests) {
  const manifestPath = resolve(source, "harness", name, "manifest.mjs");
  unlinked(manifestPath);
  const { default: manifest }: { default: PackageManifest } = await import(
    pathToFileURL(manifestPath).href
  );
  for (const mapping of manifest.files) {
    if (!/^(core|harness)\//.test(mapping.from))
      throw new Error("PACKAGE-SOURCE: only core and harness");
    const from = inside(source, mapping.from);
    const to = inside(inside(output, name), mapping.to);
    if (!existsSync(from)) throw new Error(`PACKAGE-MISSING: ${mapping.from}`);
    for (const file of files(from)) {
      // TypeScript sources stay here; their compiled .mjs siblings are distributed.
      if (file.endsWith(".mts")) continue;
      let target = resolve(to, relative(from, file));
      let bytes = readFileSync(file);
      if (file.endsWith(".md")) {
        let text = bytes.toString("utf8");
        for (const [token, value] of Object.entries(manifest.tokens ?? {}))
          text = text.replaceAll(token, value);
        if (/\{\{[A-Z_]+\}\}/.test(text))
          throw new Error(`PACKAGE-TOKEN: ${file}`);
        bytes = Buffer.from(text);
      }
      if (mapping.render) {
        const name = relative(from, file).replaceAll("\\", "/");
        const [path, text] = mapping.render(name, bytes.toString("utf8"));
        target = inside(to, path);
        bytes = Buffer.from(text);
      }
      if (expected.has(target)) throw new Error(`PACKAGE-DUPLICATE: ${target}`);
      expected.set(target, bytes);
    }
  }
}
const existing = files(output);
const extra = existing.filter((path) => !expected.has(path));
if (extra.length) throw new Error(`PACKAGE-EXTRA: ${extra.join(", ")}`);
inspected.clear();
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
