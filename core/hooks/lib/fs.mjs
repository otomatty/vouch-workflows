import * as fs from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Direct I/O in the isolated hook process; every FileStore boundary still awaits.
 * @type {import('./runtime-contracts.mjs').FileOperations} */
const native = {
  realpath: fs.realpathSync.native,
  stat: fs.statSync,
  lstat: fs.lstatSync,
  readFile: fs.readFileSync,
  mkdir: fs.mkdirSync,
  rename: fs.renameSync,
  rm(path) {
    try {
      fs.unlinkSync(path);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  },
  rmdir: fs.rmdirSync,
  open(path, flags, mode) {
    const descriptor = fs.openSync(path, flags, mode);
    return {
      writeFile: (text, encoding) =>
        fs.writeFileSync(descriptor, text, encoding),
      sync: () => fs.fsyncSync(descriptor),
      close: () => fs.closeSync(descriptor),
    };
  },
};

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Serialized, atomic replacement within a trusted root. Existing links below it are refused,
 * while another absolute spelling of the root directory itself maps to its canonical path.
 * The optional native operations port permits deterministic disk-failure tests.
 * @param {string} root
 * @param {import('./runtime-contracts.mjs').FileOperations} [operations]
 * @returns {Promise<import('./runtime-contracts.mjs').FileStore>}
 */
export async function createFileStore(root, operations = native) {
  const base = await operations.realpath(root);
  if (!(await operations.stat(base)).isDirectory())
    throw new Error("FS-ROOT: directory required");

  /**
   * An absolute path may reach the root through another spelling (8.3, junction, subst, link).
   * The shallowest ancestor that is the root wins, so links inside the root stay below it.
   * @param {string} absolute
   */
  async function belowRootAlias(absolute) {
    /** @type {string[]} */ const ancestors = [];
    for (let path = absolute; ; path = dirname(path)) {
      ancestors.unshift(path);
      if (dirname(path) === path) break;
    }
    for (const ancestor of ancestors) {
      try {
        if (relative(base, await operations.realpath(ancestor)) === "")
          return relative(ancestor, absolute);
      } catch (error) {
        if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) break;
        throw error;
      }
    }
    throw new Error("FS-ESCAPE: outside project root");
  }

  /** @param {string} path */
  async function resolvePath(path) {
    // Reject ADS and ambiguous Win32 names on every host, while allowing a drive prefix.
    if (
      !path ||
      path.includes("\0") ||
      path.replace(/^[A-Za-z]:[\\/]/, "").includes(":")
    )
      throw new Error("FS-PATH: invalid path");
    const lexical = resolve(base, path.replaceAll("\\", "/"));
    const inside = relative(base, lexical);
    const local =
      inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)
        ? await belowRootAlias(lexical)
        : inside;
    const target = join(base, local);
    let current = base;
    for (const part of local.split(sep).filter(Boolean)) {
      if (
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )
        throw new Error("FS-PATH: ambiguous or reserved filename");
      current = join(current, part);
      try {
        const info = await operations.lstat(current);
        if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1))
          throw new Error("FS-LINK: linked path");
        if (!info.isFile() && !info.isDirectory())
          throw new Error("FS-TYPE: regular file or directory required");
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
    }
    return target;
  }

  /** @param {string} path */
  async function readText(path) {
    const target = await resolvePath(path);
    try {
      if (!(await operations.lstat(target)).isFile())
        throw new Error("FS-TYPE: regular file required");
      const bytes = await operations.readFile(target);
      try {
        return new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
      } catch {
        throw new Error("FS-ENCODING: invalid UTF-8");
      }
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  /** @param {string} path @param {import('./runtime-contracts.mjs').TextUpdate} update */
  async function updateText(path, update) {
    const target = await resolvePath(path);
    await operations.mkdir(dirname(target), { recursive: true });
    await resolvePath(path);
    const lock = `${target}.vouch-lock`;
    // Check lock location too, before acquiring ownership. Never remove another writer's lock.
    await resolvePath(lock);
    try {
      await operations.mkdir(lock);
    } catch (error) {
      if (hasCode(error, "EEXIST"))
        throw new Error("FS-BUSY: update already in progress");
      throw error;
    }
    const temporary = join(lock, "next");
    try {
      const before = await readText(path);
      const after = update(before);
      if (after === null || after === before) return false;
      const handle = await operations.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(after, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await resolvePath(path);
      await operations.rename(temporary, target);
      return true;
    } finally {
      await operations.rm(temporary, { force: true });
      await operations.rmdir(lock);
    }
  }

  return {
    resolvePath,
    readText,
    updateText,
    writeText: (path, text) => updateText(path, () => text),
  };
}
