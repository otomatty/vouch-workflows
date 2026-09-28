/** @returns {string} UTC timestamp; callers inject this function through HookContext. */
export function now() {
  return new Date().toISOString();
}

/** @param {string} session @param {string} identity @returns {string} Stable replay identity. */
export function newId(session, identity) {
  // Loaded only when an identity is computed; no-op hooks never load crypto.
  return `evt_${process
    .getBuiltinModule("node:crypto")
    .createHash("sha256")
    .update(JSON.stringify([session, identity]))
    .digest("hex")}`;
}

/** @param {string} value @returns {number|null} */
function utcMilliseconds(value) {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z(?![\s\S])/.exec(
      value,
    );
  if (!match) return null;
  const instant = new Date(value);
  const milliseconds = instant.getTime();
  if (
    Number.isNaN(milliseconds) ||
    instant.toISOString() !== `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`
  )
    return null;
  return milliseconds;
}

/** @type {import('./runtime-contracts.mjs').ElapsedMilliseconds} */
export function elapsedMilliseconds(start, end) {
  const first = utcMilliseconds(start);
  const last = utcMilliseconds(end);
  if (first === null || last === null) return null;
  const elapsed = last - first;
  return Number.isSafeInteger(elapsed) && elapsed >= 0 ? elapsed : null;
}
