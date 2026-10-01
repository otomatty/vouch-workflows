import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

/**
 * Path classification for FileStore.locate, separate from the store's writes.
 * Links are followed, never refused; every lookup goes through the store's operations port.
 * @param {string} base The canonical root.
 * @param {import('./runtime-contracts.mjs').FileOperations} operations
 * @returns {(path:string,from?:string) => Promise<import('./runtime-contracts.mjs').PathLocation>}
 */
export function createLocate(base, operations) {
  return locate;

  /** @param {string} from @param {string} to */
  function outside(from, to) {
    const path = relative(from, to);
    return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
  }
  /** @type {(canonical:string,kind:import('./runtime-contracts.mjs').PathLocation['kind'],links?:number) => import('./runtime-contracts.mjs').PathLocation} */
  function located(canonical, kind, links = 0) {
    return {
      inside: outside(base, canonical)
        ? null
        : relative(base, canonical).split(sep).join("/"),
      contains: !outside(canonical, base),
      kind,
      links,
    };
  }

  /** Classification only: links are followed, never refused. See FileStore.locate.
   * @param {string} path @param {string} [from] */
  async function locate(path, from = base) {
    const lexical = resolve(base, from, path);
    if (lexical.includes("\0")) return located(lexical, "missing");
    /** @type {string[]} */ const rest = [];
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
    let real;
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
    let info;
    try {
      info = await operations.stat(real);
    } catch {
      return located(real, "unresolved");
    }
    if (info.isFile()) return located(real, "file", info.nlink);
    return located(real, info.isDirectory() ? "directory" : "other");
  }
}
