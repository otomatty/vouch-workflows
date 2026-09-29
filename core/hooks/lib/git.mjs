import build from "../../registry/build.json" with { type: "json" };
import runtime from "../../registry/runtime.json" with { type: "json" };
import guard from "../../registry/write-guard.json" with { type: "json" };
import { normalizeSegment } from "./areas.mjs";

// Git operations and DoD evidence; see docs/development/git-guard.md.
const { commits, tests } = build;

/** @type {import('./runtime-contracts.mjs').IsShellTool} */
export function isShellTool(harness, tool) {
  /** @type {Record<string,string>} */ const tools = guard.tools[harness];
  return Object.hasOwn(tools, tool) && tools[tool] === "shell";
}

/** @type {import('./runtime-contracts.mjs').Spawn} */
export async function spawn(file, args, options, execute) {
  const run = execute ?? (await import("node:child_process")).spawnSync;
  const git = file === "git";
  return run(file, git ? ["--no-optional-locks", ...args] : args, {
    windowsHide: true,
    maxBuffer: 1 << 28,
    ...(git ? { timeout: runtime.gitTimeoutMs } : {}),
    ...options,
  });
}

/** @type {import('./runtime-contracts.mjs').ReadGit} */
export function readGit(cwd, execute) {
  return async (...args) => {
    const result = await spawn("git", args, { cwd, encoding: "utf8" }, execute);
    return result.status === 0 ? String(result.stdout) : null;
  };
}

/** @type {import('./runtime-contracts.mjs').CommitType} */
export function commitType(subject) {
  const [, type = "", unit = ""] =
    /^([a-z]+)\(([^()\s]+)\)!?: \S/.exec(subject) ?? [];
  return commits.types.includes(type) ? { type, unit } : null;
}

/** @type {import('./runtime-contracts.mjs').ReadChanges} */
export function readChanges(text) {
  const parts = text.split("\0");
  return parts.flatMap((status, i) => {
    const path = parts[i + 1];
    return i % 2 === 0 && path ? [[status.trim(), path]] : [];
  });
}

/** @type {import('./runtime-contracts.mjs').BranchHistory} */
export async function branchHistory(git) {
  const patterns = build.protected.flatMap((name) => [
    `refs/heads/${name}`,
    `refs/remotes/*/${name}`,
  ]);
  const refs = await git("for-each-ref", "--format=%(refname)", ...patterns);
  const head = await git("rev-parse", "--verify", "-q", "HEAD");
  if (refs === null) return null;
  if (head === null) return [];
  // Commits reachable from HEAD but from no protected branch, merges excluded, oldest first.
  const log = await git(
    ..."log --no-merges --no-renames --reverse --name-status -z HEAD".split(
      " ",
    ),
    "--format=%x1e%H%x1f%s",
    "--not",
    ...refs.split("\n").filter(Boolean),
  );
  return (
    log
      ?.split("\x1e")
      .slice(1)
      .map((chunk) => {
        const end = chunk.indexOf("\0");
        const [sha = "", subject = ""] = chunk.slice(0, end).split("\x1f");
        return { sha, subject, changes: readChanges(chunk.slice(end + 1)) };
      }) ?? null
  );
}

/** @type {import('./runtime-contracts.mjs').DodEvidence} */
export function dodEvidence(events, intent, newId) {
  /** @type {Set<string>} */ const seen = new Set();
  for (const event of events) {
    if (
      event.type !== "hook.check" ||
      !event.commands ||
      event.synthetic ||
      event.intent !== intent ||
      !event.commit ||
      !event.clean ||
      event.id !==
        newId(
          event.commit,
          JSON.stringify(["hook.check", "dod", intent, event.output.sha256]),
        )
    )
      continue;
    if (event.result === "pass") seen.add(`${event.commit} pass`);
    if (event.commands.some((item) => (item.exit_code ?? 0) !== 0))
      seen.add(`${event.commit} fail`);
  }
  return (sha, kind) => seen.has(`${sha} ${kind}`);
}

/** A change that edits, retypes or deletes a test file. @param {import('./runtime-contracts.mjs').Change} change */
function changesTest([status, path]) {
  const parts = path.split("/").map(normalizeSegment);
  const name = parts.pop() ?? "";
  return (
    status !== "A" &&
    (parts.some((part) => tests.directories.includes(part)) ||
      tests.names.some((pattern) => new RegExp(pattern).test(name)))
  );
}

/** @type {import('./runtime-contracts.mjs').CommitViolation} */
export function commitViolation(commit, earlier, units, proven) {
  const code = commit.changes.filter(
    ([, path]) => normalizeSegment(`${path.split("/")[0]}`) !== "vouch",
  );
  const { type = "", unit = "" } = commitType(commit.subject) ?? {};
  if (code.length === 0) return null;
  if (!type) return ["type", commits.types.join(", ")];
  if (!units.includes(unit)) return ["unit", unit];
  if (type !== commits.tests && code.some(changesTest))
    return ["test", `${commits.tests}(${unit})`];
  /** @type {Record<string,string[]|undefined>} */ const requires =
    commits.requires;
  const evidence = /** @type {Record<string,'pass'|'fail'>} */ (
    commits.evidence
  );
  const chain = requires[type] ?? [];
  let from = 0;
  for (const required of chain) {
    const kind = /** @type {'pass'|'fail'} */ (evidence[required]);
    from =
      earlier.findIndex(
        (item, i) =>
          i >= from &&
          commitType(item.subject)?.type === required &&
          commitType(item.subject)?.unit === unit &&
          proven(item.sha, kind),
      ) + 1;
    if (from === 0)
      return [
        "order",
        chain
          .map((name) => `${name}(${unit}) with a ${evidence[name]}ing DoD`)
          .join(", then "),
      ];
  }
  return null;
}
