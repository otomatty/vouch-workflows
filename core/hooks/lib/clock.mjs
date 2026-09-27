import { createHash } from "node:crypto";

/** @returns {string} UTC timestamp; callers inject this function through HookContext. */
export function now() {
  return new Date().toISOString();
}

/** @param {string} session @param {string} identity @returns {string} Stable replay identity. */
export function newId(session, identity) {
  return `evt_${createHash("sha256")
    .update(JSON.stringify([session, identity]))
    .digest("hex")}`;
}
