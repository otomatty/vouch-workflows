import build from "../../registry/build.json" with { type: "json" };
import runtime from "../../registry/runtime.json" with { type: "json" };
import guard from "../../registry/write-guard.json" with { type: "json" };
import { normalizeSegment } from "./areas.mjs";

// Git operations and DoD evidence; see docs/development/git-guard.md.
const { commits, tests } = build;
const {
  requires,
  evidence,
}: {
  requires: Record<string, string[] | undefined>;
  evidence: Record<string, string>;
} = commits;

/** `git status` arguments for staged, unstaged and untracked changes: each untracked file, no renames. */
export const changeStatus = "status --porcelain -z -uall --no-renames".split(
  " ",
);

export const isShellTool: import("./runtime-contracts.mjs").IsShellTool = (
  harness,
  tool,
) => {
  const tools: Record<string, string> = guard.tools[harness];
  return Object.hasOwn(tools, tool) && tools[tool] === "shell";
};

export const spawn: import("./runtime-contracts.mjs").Spawn = async (
  file,
  args,
  options,
  execute,
) => {
  const run = execute ?? (await import("node:child_process")).spawnSync;
  const git = file === "git";
  return run(file, git ? ["--no-optional-locks", ...args] : args, {
    windowsHide: true,
    maxBuffer: 1 << 28,
    ...(git ? { timeout: runtime.gitTimeoutMs } : {}),
    ...options,
  });
};

export const readGit: import("./runtime-contracts.mjs").ReadGit = (
  cwd,
  execute,
  steps = [],
) => {
  const at = steps.flatMap((dir) => ["-C", dir]);
  return async (...args) => {
    const options = { cwd, encoding: "utf8" as const };
    const result = await spawn("git", [...at, ...args], options, execute);
    return result.status === 0 ? String(result.stdout) : null;
  };
};

export const commitType: import("./runtime-contracts.mjs").CommitType = (
  subject,
) => {
  const [, type = "", unit = ""] =
    /^([a-z]+)\(([^()\s]+)\)!?: \S/.exec(subject) ?? [];
  return commits.types.includes(type) ? { type, unit } : null;
};

export const readChanges: import("./runtime-contracts.mjs").ReadChanges = (
  text,
) => {
  const parts = text.split("\0");
  return parts.flatMap((status, i) => {
    const path = parts[i + 1];
    return i % 2 === 0 && path ? [[status.trim(), path]] : [];
  });
};

export const branchHistory: import("./runtime-contracts.mjs").BranchHistory =
  async (git, rev = "HEAD") => {
    // Commits reachable from `rev` but from no protected branch, merges excluded, oldest first.
    // A bracket keeps Git from reading a plain name as a `name/*` prefix.
    const globs = build.protected.map((name) => `[${name[0]}]${name.slice(1)}`);
    if (rev.startsWith("-")) return null;
    const log = await git(
      ..."log --no-merges --no-renames --reverse --name-status -z HEAD --format=%x1e%H%x1f%s --not"
        .split(" ")
        .map((word) => (word === "HEAD" ? rev : word)),
      ...globs.flatMap((glob) => [`--branches=${glob}`, `--remotes=*/${glob}`]),
      "--",
    );
    if (log === null)
      return (await git("rev-parse", "--verify", "-q", rev)) === null
        ? []
        : null;
    return log
      .split("\x1e")
      .slice(1)
      .map((chunk) => {
        const end = chunk.indexOf("\0");
        const [sha = "", subject = ""] = chunk.slice(0, end).split("\x1f");
        return { sha, subject, changes: readChanges(chunk.slice(end + 1)) };
      });
  };

export const dodEvidence: import("./runtime-contracts.mjs").DodEvidence = (
  events,
  intent,
  newId,
) => {
  const seen: Set<string> = new Set();
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
};

/** A change that edits, retypes or deletes a test file. */
function changesTest([status, path]: import("./runtime-contracts.mjs").Change) {
  const parts = path.split("/").map(normalizeSegment);
  const name = parts.pop() ?? "";
  return (
    status !== "A" &&
    (parts.some((part) => tests.directories.includes(part)) ||
      tests.names.some((pattern) => new RegExp(pattern).test(name)))
  );
}

/** A change outside vouch/. */
const inCode = ([, path]: import("./runtime-contracts.mjs").Change) =>
  normalizeSegment(`${path.split("/")[0]}`) !== "vouch";

export const commitViolation: import("./runtime-contracts.mjs").CommitViolation =
  (commit, earlier, units, proven) => {
    const code = commit.changes.filter(inCode);
    const { type = "", unit = "" } = commitType(commit.subject) ?? {};
    if (code.length === 0) return null;
    if (!type) return ["type", commits.types.join(", ")];
    if (!units.includes(unit)) return ["unit", unit];
    if (type !== commits.tests && code.some(changesTest))
      return ["test", `${commits.tests}(${unit})`];
    const chain = requires[type] ?? [];
    let from = 0;
    for (const required of chain) {
      const kind = evidence[required] as "pass" | "fail";
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
  };

export const unprovenTip: import("./runtime-contracts.mjs").UnprovenTip = (
  log,
  proven,
) => {
  const code = log.filter(({ changes }) => changes.some(inCode));
  const tip = code.at(-1);
  const built = code.some(({ subject }) =>
    Object.hasOwn(requires, `${commitType(subject)?.type}`),
  );
  return tip && built && !proven(tip.sha, "pass") ? tip : null;
};
