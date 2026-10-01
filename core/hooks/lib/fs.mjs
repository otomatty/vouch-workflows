import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createLocate } from "./locate.mjs";

// The builtin object avoids the ESM facade, which evaluates fs.promises and the stream getters.
const fs = process.getBuiltinModule("node:fs");

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
  readdir: (path) => fs.readdirSync(path),
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

/** @param {Uint8Array} bytes */
function decode(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error("FS-ENCODING: invalid UTF-8");
  }
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

const pause = new Int32Array(new SharedArrayBuffer(4));

/**
 * Retry a synchronous descriptor call that a nonblocking descriptor refused for now.
 * @template T @param {() => T} call @returns {T}
 */
function retrying(call) {
  for (;;) {
    try {
      return call();
    } catch (error) {
      if (!hasCode(error, "EAGAIN")) throw error;
      Atomics.wait(pause, 0, 0, 5);
    }
  }
}

/**
 * Chunks of a descriptor until end of input, read synchronously without stream modules.
 * The caller owns the size limit and stops iterating once it is exceeded.
 * @param {number} descriptor
 * @param {import('./runtime-contracts.mjs').DescriptorRead} [read]
 * @returns {Generator<Uint8Array>}
 */
export function* readDescriptor(descriptor, read = fs.readSync) {
  const buffer = Buffer.alloc(64 * 1024);
  for (;;) {
    const size = retrying(() =>
      read(descriptor, buffer, 0, buffer.length, null),
    );
    if (size === 0) return;
    yield Buffer.from(buffer.subarray(0, size));
  }
}

/**
 * A synchronous writer for a diagnostic descriptor that completes partial writes.
 * @param {number} descriptor
 * @param {import('./runtime-contracts.mjs').DescriptorWrite} [write]
 * @returns {{write:(text:string) => void}}
 */
export function descriptorWriter(descriptor, write = fs.writeSync) {
  return {
    write(text) {
      const bytes = Buffer.from(text, "utf8");
      for (let offset = 0; offset < bytes.length; )
        offset += retrying(() =>
          write(descriptor, bytes, offset, bytes.length - offset),
        );
    },
  };
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
  async function readBytes(path) {
    const target = await resolvePath(path);
    try {
      if (!(await operations.lstat(target)).isFile())
        throw new Error("FS-TYPE: regular file required");
      return Buffer.from(await operations.readFile(target));
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  /** @param {string} path */
  async function readText(path) {
    const bytes = await readBytes(path);
    return bytes === null ? null : decode(bytes);
  }

  /** @param {string} path @param {(before:Buffer|null) => Uint8Array|null} update */
  async function replaceBytes(path, update) {
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
      const before = await readBytes(path);
      const after = update(before);
      if (after === null || before?.equals(after)) return false;
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

  /** @param {string} path @param {import('./runtime-contracts.mjs').TextUpdate} update */
  function updateText(path, update) {
    return replaceBytes(path, (bytes) => {
      const before = bytes === null ? null : decode(bytes);
      const after = update(before);
      return after === null || after === before
        ? null
        : Buffer.from(after, "utf8");
    });
  }

  /** @param {string} path */
  async function list(path) {
    const target = await resolvePath(path);
    const read = operations.readdir;
    if (!read) throw new Error("FS-LIST: listing unsupported");
    let names;
    try {
      if (!(await operations.lstat(target)).isDirectory())
        throw new Error("FS-TYPE: directory required");
      names = await read(target);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
    /** @type {import('./runtime-contracts.mjs').DirectoryEntry[]} */
    const entries = [];
    for (const name of [...names].sort()) {
      const info = await operations.lstat(join(target, name));
      entries.push({
        name,
        kind:
          info.isSymbolicLink() || (info.isFile() && info.nlink !== 1)
            ? "link"
            : info.isFile()
              ? "file"
              : info.isDirectory()
                ? "directory"
                : "other",
      });
    }
    return entries;
  }

  return {
    resolvePath,
    readText,
    updateText,
    writeText: (path, text) => updateText(path, () => text),
    readBytes,
    // Create once: identical bytes are a no-op, different bytes are never replaced.
    createBytes: (path, bytes) =>
      replaceBytes(path, (before) => {
        if (before === null) return bytes;
        if (before.equals(bytes)) return null;
        throw new Error("FS-CONFLICT: different existing content");
      }),
    list,
    locate: createLocate(base, operations),
  };
}
