import guard from "../../registry/write-guard.json" with { type: "json" };

// Protected areas and approved status; see docs/development/write-guard.md.
const approvedLine = /^\s*status\s*:\s*(["']?)approved\1\s*(?:#.*)?$/i;

// Kept equal to each harness installation descriptor by the distribution tests.
/** @type {Record<string,string[]>} */
export const nativeRegistrationNames = {
  ".claude": ["settings.json", "settings.local.json"],
  ".codex": ["hooks.json", "config.toml"],
  ".cursor": ["hooks.json"],
};

/** Any line declaring approved, wherever it is. @param {string} text */
export const approvedLines = (text) =>
  text.split(/\r?\n/).some((line) => approvedLine.test(line));

/** @type {import('./runtime-contracts.mjs').NormalizeSegment} */
export function normalizeSegment(segment) {
  // "." and ".." strip to nothing and so keep their own spelling.
  const name = segment
    .replace(/:.*/s, "")
    .replace(/[. ]+$/, "")
    .toLowerCase();
  return name || segment.toLowerCase();
}

/** A glob segment may match the name at its position. @param {string} segment @param {string} name */
function matches(segment, name) {
  if (!/[*?[]/.test(segment)) return segment === name;
  let pattern = "";
  for (let i = 0; i < segment.length; i++) {
    const c = /** @type {string} */ (segment[i]);
    const close = c === "[" ? segment.indexOf("]", i + 2) : -1;
    if (c === "*") pattern += ".*";
    else if (c === "?") pattern += ".";
    else if (close > 0) {
      pattern += `[${segment
        .slice(i + 1, close)
        .replace(/^!/, "^")
        .replaceAll("\\", "\\\\")}]`;
      i = close;
    } else pattern += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  try {
    return new RegExp(`^${pattern}$`, "s").test(name);
  } catch {
    return true;
  }
}

/** @param {string[]} parts @param {string[]} prefix */
const under = (parts, prefix) =>
  prefix.every(
    (name, i) =>
      i >= parts.length || matches(/** @type {string} */ (parts[i]), name),
  );

/** @type {import('./runtime-contracts.mjs').ClassifySegments} */
export function classifySegments(segments, scope) {
  const parts = segments
    .filter((part) => part !== "" && part !== ".")
    .map(normalizeSegment);
  const star = parts.indexOf("**");
  if (star >= 0) {
    const prefix = classifySegments(parts.slice(0, star), scope);
    return prefix && { area: prefix.area, ancestor: false };
  }
  const n = guard.intents.length;
  const intents = under(parts, guard.intents);
  const home = scope.installation;
  const installed = home !== null && under(parts, home);
  if (
    intents &&
    parts.length > n + 1 &&
    matches(/** @type {string} */ (parts[n + 1]), guard.audit)
  )
    return { area: "audit", ancestor: false };
  if (parts.some((part) => part.endsWith(guard.lockSuffix)))
    return { area: "lock", ancestor: false };
  if (
    scope.managed &&
    parts.length > 0 &&
    (matches(parts[0] ?? "", ".vouch") ||
      (parts.length >= 2 && under(parts, ["vouch", "config.json"])) ||
      (parts.length >= 2 &&
        under(parts, [scope.managed]) &&
        (nativeRegistrationNames[scope.managed] ?? []).some((name) =>
          matches(parts[1] ?? "", name),
        )))
  )
    return { area: "installation", ancestor: false };
  if (
    installed &&
    parts.length > home.length &&
    scope.installed.some(
      (name) =>
        name === "*" ||
        matches(/** @type {string} */ (parts[home.length]), name),
    )
  )
    return { area: "installation", ancestor: false };
  if (
    intents &&
    parts.length === n + 2 &&
    guard.artifacts.some((name) =>
      matches(/** @type {string} */ (parts[n + 1]), name),
    )
  )
    return { area: "artifact", ancestor: false };
  if (intents && parts.length <= n + 1)
    return { area: "audit", ancestor: true };
  if (installed && parts.length <= home.length)
    return { area: "installation", ancestor: true };
  return null;
}

/** @type {import('./runtime-contracts.mjs').DeclaresApproved} */
export function declaresApproved(text) {
  const [first, ...lines] = text.replace(/^﻿/, "").split(/\r?\n/);
  if (first?.trimEnd() !== "---") return false;
  for (const line of lines) {
    if (line.trimEnd() === "---") return false;
    if (approvedLine.test(line)) return true;
  }
  return false;
}

/** @type {import('./runtime-contracts.mjs').ParsePatch} */
export function parsePatch(text) {
  /** @type {import('./runtime-contracts.mjs').PatchOperation[]} */
  const operations = [];
  for (const line of text.split(/\r?\n/)) {
    const file = /^\s*\*\*\*\s*(add|update|delete) file:\s*(.*?)\s*$/i.exec(
      line,
    );
    const move = /^\s*\*\*\*\s*move to:\s*(.*?)\s*$/i.exec(line);
    const last = operations.at(-1);
    if (file)
      operations.push({
        kind: /** @type {'add'|'update'|'delete'} */ (
          /** @type {string} */ (file[1]).toLowerCase()
        ),
        path: /** @type {string} */ (file[2]),
        to: null,
        added: [],
      });
    else if (move && last) last.to = /** @type {string} */ (move[1]);
    else if (last && line.startsWith("+")) last.added.push(line.slice(1));
  }
  return operations;
}
