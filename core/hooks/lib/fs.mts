import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createLocate } from "./locate.mjs";

// The builtin object avoids the ESM facade, which evaluates fs.promises and the stream getters.
const fs = process.getBuiltinModule("node:fs");

/** Direct I/O in the isolated hook process; every FileStore boundary still awaits. */
const native: import("./runtime-contracts.mjs").FileOperations = {
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

function decode(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error("FS-ENCODING: invalid UTF-8");
  }
}

function hasCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

const pause = new Int32Array(new SharedArrayBuffer(4));

/** Retry a synchronous descriptor call that a nonblocking descriptor refused for now. @template T */
function retrying<T>(call: () => T): T {
  for (;;) {
    try {
      return call();
    } catch (error) {
      if (!hasCode(error, "EAGAIN")) throw error;
      Atomics.wait(pause, 0, 0, 5);
    }
  }
}

/** Chunks of a descriptor until end of input, read synchronously without stream modules. The caller owns the size limit and stops iterating once it is exceeded. */
export function* readDescriptor(
  descriptor: number,
  read: import("./runtime-contracts.mjs").DescriptorRead = fs.readSync,
): Generator<Uint8Array> {
  const buffer = Buffer.alloc(64 * 1024);
  for (;;) {
    const size = retrying(() =>
      read(descriptor, buffer, 0, buffer.length, null),
    );
    if (size === 0) return;
    yield Buffer.from(buffer.subarray(0, size));
  }
}

/** A synchronous writer for a diagnostic descriptor that completes partial writes. */
export function descriptorWriter(
  descriptor: number,
  write: import("./runtime-contracts.mjs").DescriptorWrite = fs.writeSync,
): { write: (text: string) => void } {
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

/** Serialized, atomic replacement within a trusted root. Existing links below it are refused, while another absolute spelling of the root directory itself maps to its canonical path. The optional native operations port permits deterministic disk-failure tests. */
export async function createFileStore(
  root: string,
  operations: import("./runtime-contracts.mjs").FileOperations = native,
): Promise<import("./runtime-contracts.mjs").FileStore> {
  const base = await operations.realpath(root);
  if (!(await operations.stat(base)).isDirectory())
    throw new Error("FS-ROOT: directory required");

  /** An absolute path may reach the root through another spelling (8.3, junction, subst, link). The shallowest ancestor that is the root wins, so links inside the root stay below it. */
  async function belowRootAlias(absolute: string) {
    const ancestors: string[] = [];
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

  async function resolvePath(path: string) {
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

  async function readBytes(path: string) {
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

  async function readText(path: string) {
    const bytes = await readBytes(path);
    return bytes === null ? null : decode(bytes);
  }

  async function replaceBytes(
    path: string,
    update: (before: Buffer | null) => Uint8Array | null,
  ) {
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

  function updateText(
    path: string,
    update: import("./runtime-contracts.mjs").TextUpdate,
  ) {
    return replaceBytes(path, (bytes) => {
      const before = bytes === null ? null : decode(bytes);
      const after = update(before);
      return after === null || after === before
        ? null
        : Buffer.from(after, "utf8");
    });
  }

  async function list(path: string) {
    const target = await resolvePath(path);
    const read = operations.readdir;
    if (!read) throw new Error("FS-LIST: listing unsupported");
    let names: string[];
    try {
      if (!(await operations.lstat(target)).isDirectory())
        throw new Error("FS-TYPE: directory required");
      names = await read(target);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
    const entries: import("./runtime-contracts.mjs").DirectoryEntry[] = [];
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
