import build from "../../registry/build.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import guard from "../../registry/write-guard.json" with { type: "json" };
import { listEvents } from "./audit.mjs";
import { readPlan } from "./checkpoints.mjs";
import {
  branchHistory,
  changeStatus,
  commitViolation,
  dodEvidence,
  isShellTool,
  readGit,
  unprovenTip,
} from "./git.mjs";
import { parseShell, programOf } from "./shell.mjs";

// Git push and commit checks; see docs/development/git-guard.md.
/**
 * @typedef {import('./contracts.mjs').ReadyHookContext} Context
 * @typedef {import('./runtime-contracts.mjs').GitPort} GitPort
 * @typedef {{sub:string,args:string[],git:GitPort|null,dynamic:boolean,staged:boolean}} Invocation `git`: null when the directory is built at run time; `staged`: an earlier Git command may stage.
 * @typedef {[id:string,shown:string,why:string]} Found
 */
/** Global options that take the next word as their value. */
const valued = /^(?:-c|--(?:namespace|config-env|git-dir|work-tree))$/;
/** @type {Record<'type'|'unit'|'test'|'order',(detail:string)=>string>} */
const reasons = {
  type: (types) =>
    `code changes need a "<type>(<Unit>): " subject with a type in ${types}`,
  unit: (unit) => `${unit} is not a Unit of the plan`,
  test: (typed) => `test files change or disappear only in ${typed} commits`,
  order: (chain) => `the implementation needs ${chain} earlier on this branch`,
};

/**
 * Git invocations with their `-C` and fixed `cd` steps from the input cwd.
 * @param {string} text @param {string} cwd @param {import('./runtime-contracts.mjs').SpawnPort} [execute]
 * @returns {Invocation[]}
 */
function invocations(text, cwd, execute) {
  /** @type {Invocation[]} */ const found = [];
  /** @type {string[]|null} */ let dirs = [];
  const { commands } = parseShell(text);
  for (const [index, command] of commands.entries()) {
    const [program = "", ...args] = programOf(command);
    // An unquoted substitution ends the command early and opens a deeper one.
    const dynamic =
      command.expands.slice(-args.length - 1).some(Boolean) ||
      (commands[index + 1]?.depth ?? 0) > command.depth;
    if (program === "cd")
      dirs =
        dirs && args.length === 1 && !dynamic && !/^-/.test(`${args[0]}`)
          ? [...dirs, `${args[0]}`]
          : null;
    const merge = program === "gh" && args[0] === "pr" && args[1] === "merge";
    if (program !== "git" && !merge) continue;
    /** @type {string[]|null} */ let steps = dirs;
    let i = 0;
    for (; args[i]?.startsWith("-"); i++) {
      const option = `${args[i]}`;
      if (/^--(?:git-dir|work-tree)/.test(option)) steps = null;
      if (option === "-C") steps = steps && [...steps, `${args[++i]}`];
      else if (valued.test(option)) i++;
    }
    found.push({
      sub: merge ? "pr merge" : `${args[i]}`,
      args: args.slice(merge ? 2 : i + 1),
      git: steps && readGit(cwd, execute, steps),
      dynamic,
      staged: found.some((item) => /^(?:add|rm|mv)$/.test(item.sub)),
    });
  }
  return found;
}

/** The configured Intent's commits of `rev`, plan Units and DoD evidence; null outside the project
 * repository or without an Intent; a string when unreadable. @param {GitPort} git @param {Context} ctx @param {string} [rev] */
async function branch(git, ctx, rev) {
  if (!ctx.intent) return null;
  const top = await git("rev-parse", "--show-toplevel");
  if (top === null || (await ctx.locate(top.trim())).inside !== "") return null;
  try {
    const log = await branchHistory(git, rev);
    const text = await ctx.readText(
      `${guard.intents.join("/")}/${ctx.intent}/${documents.artifacts.intent}`,
    );
    const plan = text === null ? { error: "" } : readPlan(text);
    const events = await listEvents(ctx.audit);
    if (log === null) throw new Error("GIT-HISTORY");
    return {
      log,
      units: "plan" in plan ? plan.plan.units.map((unit) => unit.id) : [],
      proven: dodEvidence(events, ctx.intent, ctx.newId),
    };
  } catch {
    return "the branch history, the plan or the audit could not be read";
  }
}

/** @param {Invocation} git @param {Context} ctx @returns {Promise<Found|null>} */
async function push(git, ctx) {
  const shown = ["git push", ...git.args].join(" ");
  /** @type {string[]} */ const targets = [];
  /** @type {string[]} */ const sources = [];
  const deleting = git.args.some((arg) => /^(?:-d|--delete)$/.test(arg));
  let words = 0;
  for (let i = 0; i < git.args.length; i++) {
    const arg = `${git.args[i]}`;
    if (/^(?:-n|--dry-run)$/.test(arg)) return null;
    if (/^--(?:all|mirror|branches)$/.test(arg)) targets.push("*");
    if (/^--repo/.test(arg)) words++;
    if (/^(?:-o|--push-option|--receive-pack|--exec|--repo)$/.test(arg)) i++;
    const [from = "", ...rest] = arg.replace(/^\+/, "").split(":");
    const to = `${rest.at(-1) ?? from}`;
    if (!arg.startsWith("-") && words++ > 0) {
      targets.push(to.includes("*") ? "*" : to.replace(/^refs\/heads\//, ""));
      sources.push(deleting ? "" : from);
    }
  }
  if (targets.length === 0 && !git.args.includes("--tags")) targets.push("");
  const current = targets.some((name) => name === "" || name === "HEAD");
  if (git.dynamic || (current && !git.git))
    return ["VOUCH-GIT-PUSH", shown, "the destination cannot be verified"];
  const names = [...targets];
  // `## <branch>...<remote>/<upstream>`: the current branch and, for a default push, its upstream.
  const status =
    current && (await git.git?.("status", "-b", "--porcelain", "-z", "-uno"));
  const [, head = "", upstream = ""] =
    /^## (?:No commits yet on )?(\S+?)(?:\.{3}[^/\s]*\/(\S+))?(?: |$)/.exec(
      `${`${status}`.split("\0", 1)}`,
    ) ?? [];
  if (current && !head)
    return ["VOUCH-GIT-PUSH", shown, "the destination cannot be verified"];
  names.push(head, targets.includes("") ? upstream : "");
  const main = names.find(
    (name) => name === "*" || build.protected.includes(name),
  );
  if (main !== undefined)
    return [
      "VOUCH-GIT-PUSH",
      shown,
      `${main === "*" ? "all branches include a protected branch" : `${main} is protected`}; it changes only through a pull request a person merges`,
    ];
  // Each source's own commits; a deletion sends none, and no refspec sends HEAD.
  for (const rev of new Set(sources.length ? sources : ["HEAD"])) {
    const found = rev ? git.git && (await branch(git.git, ctx, rev)) : null;
    if (typeof found === "string")
      return ["VOUCH-GIT-UNVERIFIED", shown, found];
    if (!found) continue;
    const { log, units, proven } = found;
    for (const [i, item] of log.entries()) {
      const broken = commitViolation(item, log.slice(0, i), units, proven);
      const at = `git push (${item.sha.slice(0, 12)} ${item.subject})`;
      if (broken) return explain(broken, at);
    }
    const tip = unprovenTip(log, proven);
    const at = tip && `git push (${tip.sha.slice(0, 12)} ${tip.subject})`;
    const why =
      "the implementation needs a passing DoD at its last code commit";
    if (at) return ["VOUCH-COMMIT-EVIDENCE", at, why];
  }
  return null;
}

/** An early check of a commit whose subject `-m` names; a push checks the recorded commits.
 * @param {Invocation} git @param {Context} ctx @returns {Promise<Found|null>} */
async function commit(git, ctx) {
  const at = git.args.findIndex((arg) =>
    /^-[^-]*m$|^--message(?:=|$)/.test(arg),
  );
  const attached = /^--message=([\s\S]*)/.exec(`${git.args[at]}`);
  const message = `${attached ? attached[1] : git.args[at + 1]}`;
  const heredoc = /^\$\(cat <<-?\s*(['"]?)\w+\1\r?\n(.*)/.exec(message);
  const subject = `${heredoc ? heredoc[2] : message.split("\n")[0]}`;
  if (at < 0 || !git.git || /[$`]/.test(subject)) return null;
  const found = await branch(git.git, ctx);
  if (typeof found === "string")
    return ["VOUCH-GIT-UNVERIFIED", subject, found];
  if (found === null) return null;
  const all =
    git.staged || git.args.some((arg) => /^-[^-]*a|^--all$/.test(arg));
  const status = await git.git(...changeStatus);
  if (status === null)
    return ["VOUCH-GIT-UNVERIFIED", subject, "the changes could not be read"];
  /** @type {import('./runtime-contracts.mjs').Change[]} */ const changes = [];
  for (const entry of status.split("\0").filter(Boolean)) {
    // The index column, with the worktree under -a; untracked files only after an add.
    if (entry.startsWith("??") && !git.staged) continue;
    const code = entry.slice(0, all ? 2 : 1).replaceAll("?", "A");
    const kind = ["D", "A", "M", "T"].find((letter) => code.includes(letter));
    if (kind) changes.push([kind.replace("T", "M"), entry.slice(3)]);
  }
  const { log, units, proven } = found;
  const broken = commitViolation({ subject, changes }, log, units, proven);
  return broken && explain(broken, subject);
}

/** @param {['type'|'unit'|'test'|'order',string]} broken @param {string} shown @returns {Found} */
function explain([rule, detail], shown) {
  return [`VOUCH-COMMIT-${rule.toUpperCase()}`, shown, reasons[rule](detail)];
}

/** @type {import('./runtime-contracts.mjs').GuardGit} */
export async function guardGit(input, ctx, execute) {
  if (
    input.hook_event_name !== "PreToolUse" ||
    !isShellTool(ctx.harness, input.tool_name)
  )
    return { decision: "allow" };
  const text = input.tool_input.command;
  for (const git of typeof text === "string"
    ? invocations(text, input.cwd, execute)
    : []) {
    /** @type {Found} */ const merged = [
      "VOUCH-GIT-MERGE",
      ["gh pr merge", ...git.args].join(" "),
      "a person merges the pull request after reading the Brief",
    ];
    const found =
      git.sub === "pr merge"
        ? merged
        : git.sub === "push"
          ? await push(git, ctx)
          : git.sub === "commit"
            ? await commit(git, ctx)
            : null;
    if (found)
      return {
        decision: "deny",
        reason: `${found[0]}: Bash ${found[1].slice(0, 200)}; ${found[2]}`
          .slice(0, 600)
          .replace(/\p{Cc}/gu, "?"),
      };
  }
  return { decision: "allow" };
}
