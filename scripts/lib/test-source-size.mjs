import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Estimate scheduling cost from test code and its shared local helper bodies.
 * This reads source only; it never executes a helper or caches a test result.
 * @param {string[]} files @param {string} helpersRoot
 * @param {(path:string)=>string} [read] */
export function testSourceSizes(
  files,
  helpersRoot,
  read = (path) => readFileSync(path, "utf8"),
) {
  const root = resolve(helpersRoot);
  /** @type {Map<string,{bytes:number,dependencies:string[]}>} */
  const sources = new Map();
  /** @param {string} file @param {Set<string>} visited @returns {number} */
  function total(file, visited) {
    if (visited.has(file)) return 0;
    visited.add(file);
    let source = sources.get(file);
    if (!source) {
      const text = read(file);
      const dependencies = [];
      for (const match of text.matchAll(
        /^\s*(?:import\s+(?:[^;"']+?\s+from\s+)?|export\s+[^;"']+?\s+from\s+)["']([^"']+\.mjs)["']/gm,
      )) {
        const specifier = match[1] ?? "";
        if (!specifier.startsWith(".")) continue;
        const target = resolve(dirname(file), specifier);
        const part = relative(root, target);
        if (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))
          dependencies.push(target);
      }
      source = { bytes: Buffer.byteLength(text), dependencies };
      sources.set(file, source);
    }
    return source.dependencies.reduce(
      (bytes, path) => bytes + total(path, visited),
      source.bytes,
    );
  }
  return new Map(files.map((file) => [file, total(file, new Set())]));
}
