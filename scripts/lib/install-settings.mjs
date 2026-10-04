import { isDeepStrictEqual } from "node:util";
import {
  json,
  object,
  pretty,
} from "../../core/hooks/lib/installation-ownership.mjs";

export {
  json,
  object,
  pretty,
} from "../../core/hooks/lib/installation-ownership.mjs";

/** @typedef {Record<string,unknown>} ObjectValue */
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

/** @param {string|null} text @param {string} harness @param {string} body */
export function block(text, harness, body) {
  if (text?.includes(`<!-- vouch:${harness}:start -->`))
    throw new Error("INSTALL-CONFLICT: unmanaged Vouch block");
  return `${text && !text.endsWith("\n") ? "\n" : ""}\n<!-- vouch:${harness}:start -->\n${body}\n<!-- vouch:${harness}:end -->\n`;
}
