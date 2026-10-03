import { isDeepStrictEqual } from "node:util";

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

/** @param {string|null} text @param {ObjectValue} contribution */
export function addHooks(text, contribution) {
  const actual = json(text);
  if (actual.hooks !== undefined && !object(actual.hooks))
    throw new Error("INSTALL-CONFIG: hooks must be an object");
  const hooks = { .../** @type {ObjectValue} */ (actual.hooks ?? {}) };
  for (const [event, entries] of Object.entries(
    /** @type {ObjectValue} */ (contribution.hooks),
  )) {
    const prior = hooks[event] ?? [];
    if (!Array.isArray(prior) || !Array.isArray(entries))
      throw new Error("INSTALL-CONFIG: hook registrations must be arrays");
    if (
      prior.some((item) =>
        entries.some((entry) => isDeepStrictEqual(item, entry)),
      )
    )
      throw new Error(
        "INSTALL-CONFLICT: identical unmanaged hook registration",
      );
    hooks[event] = [...prior, ...entries];
  }
  for (const [key, value] of Object.entries(contribution)) {
    if (key === "hooks") continue;
    if (actual[key] !== undefined && !isDeepStrictEqual(actual[key], value))
      throw new Error(`INSTALL-CONFLICT: ${key}`);
    actual[key] = value;
  }
  return pretty({ ...actual, hooks });
}

/** Remove only owned entries; unrelated changes stay intact.
 * @param {string|null} text @param {string} content @param {string|null} previous */
export function removeHooks(text, content, previous) {
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
export function removeBlock(text, content, previous) {
  if (
    text === null ||
    !text.includes(content) ||
    text.indexOf(content) !== text.lastIndexOf(content)
  )
    throw new Error("INSTALL-CONFLICT: owned documentation block changed");
  const after = text.replace(content, "");
  return after === (previous ?? "") ? previous : after;
}

/** @param {string|null} text @param {string} harness @param {string} body */
export function block(text, harness, body) {
  if (text?.includes(`<!-- vouch:${harness}:start -->`))
    throw new Error("INSTALL-CONFLICT: unmanaged Vouch block");
  return `${text && !text.endsWith("\n") ? "\n" : ""}\n<!-- vouch:${harness}:start -->\n${body}\n<!-- vouch:${harness}:end -->\n`;
}
