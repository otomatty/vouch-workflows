import { isDeepStrictEqual } from "node:util";
import { removeCodex } from "./installation-toml.mjs";

/** @typedef {Record<string,unknown>} ObjectValue */
/** @param {unknown} value @returns {value is ObjectValue} */
export const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** @param {string|null} text @returns {ObjectValue} */
export function json(text) {
  const value = text === null ? {} : JSON.parse(text);
  if (!object(value)) throw new Error("INSTALL-CONFIG: expected JSON object");
  return value;
}
/** @param {unknown} value */
export const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Require the complete project activation set independently of the recorded list.
 * @param {Record<string,string>} source @param {string} harness @param {unknown[]} owned */
export function verifyActivationManifest(source, harness, owned) {
  const skills =
    harness === "codex" ? ".agents/skills/" : `.${harness}/skills/`;
  const expected = new Map([
    ["AGENTS.md", "block"],
    [
      `.${harness}/${harness === "claude" ? "settings" : "hooks"}.json`,
      "hooks",
    ],
    [`${skills}vouch/SKILL.md`, "file"],
  ]);
  for (const path of Object.keys(source))
    if (path.startsWith(skills) || path.startsWith(`.${harness}/agents/`))
      expected.set(path, "file");
  if (harness === "claude") expected.set("CLAUDE.md", "block");
  if (harness === "codex") expected.set(".codex/config.toml", "toml");
  if (harness === "cursor") expected.set(".cursor/rules/vouch.mdc", "file");
  if (
    owned.length !== expected.size ||
    [...expected].some(
      ([path, kind]) =>
        owned.filter(
          (entry) =>
            object(entry) && entry.path === path && entry.kind === kind,
        ).length !== 1,
    )
  )
    throw new Error(
      "INSTALL-STATE: incomplete or invalid activation ownership manifest",
    );
}

/** Remove only owned entries; unrelated changes stay intact.
 * @param {string|null} text @param {string} content @param {string|null} previous */
function removeHooks(text, content, previous) {
  const actual = json(text);
  const contribution = json(content);
  const before = json(previous);
  if (!object(actual.hooks) || !object(contribution.hooks))
    throw new Error("INSTALL-CONFLICT: owned hooks missing");
  const hooks = { ...actual.hooks };
  for (const [event, entries] of Object.entries(contribution.hooks)) {
    const remaining = hooks[event];
    if (!Array.isArray(remaining) || !Array.isArray(entries))
      throw new Error("INSTALL-CONFLICT: owned hooks changed");
    const kept = [...remaining];
    for (const entry of entries) {
      if (kept.filter((item) => isDeepStrictEqual(item, entry)).length !== 1)
        throw new Error("INSTALL-CONFLICT: owned hook duplicated or missing");
      const index = kept.findIndex((item) => isDeepStrictEqual(item, entry));
      if (index < 0)
        throw new Error("INSTALL-CONFLICT: owned hook changed or removed");
      kept.splice(index, 1);
    }
    if (
      kept.length ||
      (object(before.hooks) && Object.hasOwn(before.hooks, event))
    )
      hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length || Object.hasOwn(before, "hooks"))
    actual.hooks = hooks;
  else delete actual.hooks;
  for (const [key, value] of Object.entries(contribution)) {
    if (key === "hooks") continue;
    if (!isDeepStrictEqual(actual[key], value))
      throw new Error(`INSTALL-CONFLICT: owned ${key} changed`);
    if (Object.hasOwn(before, key)) actual[key] = before[key];
    else delete actual[key];
  }
  return isDeepStrictEqual(actual, before) ? previous : pretty(actual);
}

/** @param {string|null} text @param {string} content @param {string|null} previous */
function removeBlock(text, content, previous) {
  if (
    text === null ||
    !text.includes(content) ||
    text.indexOf(content) !== text.lastIndexOf(content)
  )
    throw new Error("INSTALL-CONFLICT: owned documentation block changed");
  const after = text.replace(content, "");
  return after === (previous ?? "") ? previous : after;
}

/** Validate and restore only an owned contribution; callers may discard the result.
 * @param {string|null} text @param {unknown} entry @returns {string|null} */
export function restoreOwned(text, entry) {
  if (
    !object(entry) ||
    typeof entry.path !== "string" ||
    typeof entry.content !== "string" ||
    (entry.previous !== null && typeof entry.previous !== "string") ||
    !["file", "block", "hooks", "toml"].includes(String(entry.kind))
  )
    throw new Error("INSTALL-STATE: invalid owned entry");
  if (entry.kind === "file") {
    if (text !== entry.content)
      throw new Error(`INSTALL-CONFLICT: ${entry.path}`);
    return entry.previous;
  }
  if (entry.kind === "block")
    return removeBlock(text, entry.content, entry.previous);
  if (entry.kind === "hooks")
    return removeHooks(text, entry.content, entry.previous);
  return removeCodex(text, entry.content, entry.previous);
}
