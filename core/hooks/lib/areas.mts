import guard from "../../registry/write-guard.json" with { type: "json" };

// Protected areas and approved status; see docs/development/write-guard.md.
const approvedLine = /^\s*status\s*:\s*(["']?)approved\1\s*(?:#.*)?$/i;

/** Any line declaring approved, wherever it is. */
export const approvedLines = (text: string) =>
  text.split(/\r?\n/).some((line) => approvedLine.test(line));

export const normalizeSegment: import("./runtime-contracts.mjs").NormalizeSegment =
  (segment) => {
    // "." and ".." strip to nothing and so keep their own spelling.
    const name = segment
      .replace(/:.*/s, "")
      .replace(/[. ]+$/, "")
      .toLowerCase();
    return name || segment.toLowerCase();
  };

/** A glob segment may match the name at its position. */
function matches(segment: string, name: string) {
  if (!/[*?[]/.test(segment)) return segment === name;
  let pattern = "";
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i] as string;
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

const under = (parts: string[], prefix: string[]) =>
  prefix.every(
    (name, i) => i >= parts.length || matches(parts[i] as string, name),
  );

export const classifySegments: import("./runtime-contracts.mjs").ClassifySegments =
  (segments, scope) => {
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
      matches(parts[n + 1] as string, guard.audit)
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
          [
            "hooks.json",
            "settings.json",
            "settings.local.json",
            "config.toml",
          ].some((name) => matches(parts[1] ?? "", name))))
    )
      return { area: "installation", ancestor: false };
    if (
      installed &&
      parts.length > home.length &&
      scope.installed.some(
        (name) => name === "*" || matches(parts[home.length] as string, name),
      )
    )
      return { area: "installation", ancestor: false };
    if (
      intents &&
      parts.length === n + 2 &&
      guard.artifacts.some((name) => matches(parts[n + 1] as string, name))
    )
      return { area: "artifact", ancestor: false };
    if (intents && parts.length <= n + 1)
      return { area: "audit", ancestor: true };
    if (installed && parts.length <= home.length)
      return { area: "installation", ancestor: true };
    return null;
  };

export const declaresApproved: import("./runtime-contracts.mjs").DeclaresApproved =
  (text) => {
    const [first, ...lines] = text.replace(/^﻿/, "").split(/\r?\n/);
    if (first?.trimEnd() !== "---") return false;
    for (const line of lines) {
      if (line.trimEnd() === "---") return false;
      if (approvedLine.test(line)) return true;
    }
    return false;
  };

export const parsePatch: import("./runtime-contracts.mjs").ParsePatch = (
  text,
) => {
  const operations: import("./runtime-contracts.mjs").PatchOperation[] = [];
  for (const line of text.split(/\r?\n/)) {
    const file = /^\s*\*\*\*\s*(add|update|delete) file:\s*(.*?)\s*$/i.exec(
      line,
    );
    const move = /^\s*\*\*\*\s*move to:\s*(.*?)\s*$/i.exec(line);
    const last = operations.at(-1);
    if (file)
      operations.push({
        kind: (file[1] as string).toLowerCase() as "add" | "update" | "delete",
        path: file[2] as string,
        to: null,
        added: [],
      });
    else if (move && last) last.to = move[1] as string;
    else if (last && line.startsWith("+")) last.added.push(line.slice(1));
  }
  return operations;
};
