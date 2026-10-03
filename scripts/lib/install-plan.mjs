import { inside, read, readInside } from "./install-files.mjs";
import {
  addHooks,
  block,
  json,
  pretty,
  removeBlock,
  removeHooks,
} from "./install-settings.mjs";
import { enableCodex, removeCodex } from "./install-toml.mjs";

/** @typedef {{path:string,kind:'file'|'block'|'hooks'|'toml',content:string,previous:string|null}} Owned */
/** @typedef {{v:1,harness:string,scope:string,digest:string,runtimeRoot:string,owned:Owned[]}} Installation */

/** @param {string} root @param {Installation|null} prior */
export function plan(root, prior) {
  /** @type {Map<string,import('./install-files.mjs').Change>} */ const changes =
    new Map();
  /** @type {Owned[]} */ const owned = [];
  /** @param {string} path */
  const current = (path) =>
    changes.has(path)
      ? /** @type {import('./install-files.mjs').Change} */ (changes.get(path))
          .after
      : readInside(root, path);
  /** @param {string} path @param {string|null} after */
  function put(path, after) {
    const previous = changes.get(path);
    const target = inside(root, path);
    changes.set(path, {
      path: target,
      before: previous ? previous.before : read(target),
      after,
    });
  }
  for (const entry of prior?.owned ?? []) {
    const text = current(entry.path);
    let restored;
    if (entry.kind === "file") {
      if (text !== entry.content)
        throw new Error(`INSTALL-CONFLICT: ${entry.path}`);
      restored = entry.previous;
    } else if (entry.kind === "block")
      restored = removeBlock(text, entry.content, entry.previous);
    else if (entry.kind === "hooks")
      restored = removeHooks(text, entry.content, entry.previous);
    else restored = removeCodex(text, entry.content, entry.previous);
    put(entry.path, restored);
  }
  /** @param {string} path @param {Owned['kind']} kind @param {string} content @param {string} after */
  function claim(path, kind, content, after) {
    const previous = current(path);
    owned.push({ path, kind, content, previous });
    put(path, after);
  }
  return {
    changes,
    owned,
    current,
    put,
    /** @param {string} path @param {string} text */
    file(path, text) {
      if (current(path) !== null)
        throw new Error(`INSTALL-CONFLICT: unmanaged ${path}`);
      claim(path, "file", text, text);
    },
    /** @param {string} path @param {string} harness @param {string} body */
    document(path, harness, body) {
      const before = current(path);
      const content = block(before, harness, body);
      claim(path, "block", content, `${before ?? ""}${content}`);
    },
    /** @param {string} path @param {Record<string,unknown>} contribution */
    hooks(path, contribution) {
      contribution = { ...contribution };
      // A user-provided display remains theirs; own only a display we add.
      if (json(current(path)).statusLine !== undefined)
        delete contribution.statusLine;
      claim(
        path,
        "hooks",
        pretty(contribution),
        addHooks(current(path), contribution),
      );
    },
    /** @param {string} path */
    codex(path) {
      const result = enableCodex(current(path));
      claim(path, "toml", result.content, result.text);
    },
    /** @param {string} path @param {Record<string,unknown>} value */
    merge(path, value) {
      put(path, pretty({ ...json(current(path)), ...value }));
    },
  };
}

/** @param {string|null} text @returns {Installation|null} */
export function readInstallation(text) {
  if (text === null) return null;
  const value = json(text);
  if (
    value.v !== 1 ||
    !["claude", "codex", "cursor"].includes(String(value.harness)) ||
    !["project", "user"].includes(String(value.scope)) ||
    typeof value.runtimeRoot !== "string" ||
    typeof value.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.digest) ||
    !Array.isArray(value.owned)
  )
    throw new Error("INSTALL-STATE: invalid installation descriptor");
  for (const entry of value.owned)
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.path !== "string" ||
      !["file", "block", "hooks", "toml"].includes(entry.kind) ||
      typeof entry.content !== "string" ||
      (entry.previous !== null && typeof entry.previous !== "string")
    )
      throw new Error("INSTALL-STATE: invalid ownership record");
  return /** @type {Installation} */ (/** @type {unknown} */ (value));
}
