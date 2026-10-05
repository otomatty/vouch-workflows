import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

/** Path classification for FileStore.locate, separate from the store's writes. Links are followed, never refused; every lookup goes through the store's operations port. @param base The canonical root. */
export function createLocate(
  base: string,
  operations: import("./runtime-contracts.mjs").FileOperations,
): (
  path: string,
  from?: string,
) => Promise<import("./runtime-contracts.mjs").PathLocation> {
  return locate;

  function outside(from: string, to: string) {
    const path = relative(from, to);
    return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
  }
  function located(
    canonical: string,
    kind: import("./runtime-contracts.mjs").PathLocation["kind"],
    links = 0,
  ): import("./runtime-contracts.mjs").PathLocation {
    return {
      inside: outside(base, canonical)
        ? null
        : relative(base, canonical).split(sep).join("/"),
      contains: !outside(canonical, base),
      canonical,
      kind,
      links,
    };
  }

  /** Classification only: links are followed, never refused. See FileStore.locate. */
  async function locate(path: string, from: string = base) {
    const lexical = resolve(base, from, path);
    if (lexical.includes("\0")) return located(lexical, "missing");
    const rest: string[] = [];
    let existing = lexical;
    for (;;) {
      try {
        await operations.lstat(existing);
        break;
      } catch {
        // Missing, denied, looping or too long: one word must not fail a guard open.
        if (dirname(existing) === existing) return located(lexical, "missing");
        rest.unshift(basename(existing));
        existing = dirname(existing);
      }
    }
    let real: string;
    try {
      real = await operations.realpath(existing);
    } catch {
      // A dangling or looping link stays where its own directory really is.
      let parent = dirname(existing);
      try {
        parent = await operations.realpath(parent);
      } catch {}
      return located(join(parent, basename(existing), ...rest), "unresolved");
    }
    if (rest.length > 0) return located(join(real, ...rest), "missing");
    let info: import("node:fs").Stats;
    try {
      info = await operations.stat(real);
    } catch {
      return located(real, "unresolved");
    }
    if (info.isFile()) return located(real, "file", info.nlink);
    return located(real, info.isDirectory() ? "directory" : "other");
  }
}
