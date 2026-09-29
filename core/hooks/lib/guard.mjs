import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import runtime from "../../registry/runtime.json" with { type: "json" };
import guard from "../../registry/write-guard.json" with { type: "json" };
import {
  approvedLines,
  classifySegments,
  declaresApproved,
  normalizeSegment,
  parsePatch,
} from "./areas.mjs";
import { parseShell, programOf, readsOnly } from "./shell.mjs";

/** Reason IDs in priority order; see docs/development/write-guard.md. */
const reasons = {
  audit: [
    "VOUCH-GUARD-AUDIT",
    "audit records are appended only by Vouch hooks",
  ],
  lock: [
    "VOUCH-GUARD-LOCK",
    "a Vouch hook owns this lock and its pending file",
  ],
  installation: [
    "VOUCH-GUARD-INSTALLATION",
    "the installed hook registration and runtime change only by reinstalling the distribution",
  ],
  approved: [
    "VOUCH-GUARD-APPROVED",
    "tools neither change nor create approved artifacts",
  ],
  artifact: [
    "VOUCH-GUARD-ARTIFACT",
    "shell writes to Vouch artifacts cannot be verified; use the file edit tool",
  ],
  link: ["VOUCH-GUARD-LINK", "the real target of this link cannot be verified"],
  unverified: [
    "VOUCH-GUARD-UNVERIFIED",
    "the current artifact could not be read to verify its status",
  ],
};
/** @typedef {keyof typeof reasons} Reason */
const order = Object.keys(reasons);
/** @param {string} path */
const split = (path) => path.replaceAll("\\", "/").split("/");

/** @param {import('./contracts.mjs').ReadyHookContext} ctx @param {string} entry
 * @returns {Promise<import('./runtime-contracts.mjs').GuardScope>} */
async function guardScope(ctx, entry) {
  const hook = entry.startsWith("file:") ? fileURLToPath(entry) : entry;
  const home = (await ctx.locate(dirname(dirname(hook)))).inside;
  if (!home) return { installation: null, installed: [] };
  let installed = ["*"];
  try {
    const value = JSON.parse(
      (await ctx.readText(`${home}/registry/installation.json`)) ?? "",
    );
    if (typeof value.registration === "string")
      installed = [
        ...guard.installation,
        value.registration,
        ...[value.configuration, ...(value.overrides ?? [])].filter(
          (name) => typeof name === "string",
        ),
      ];
  } catch {
    // An unreadable descriptor protects the whole installation directory.
  }
  return {
    installation: split(home).map(normalizeSegment),
    installed: installed.map(normalizeSegment),
  };
}

/** @type {import('./runtime-contracts.mjs').GuardWrites} */
export async function guardWrites(input, ctx, entry) {
  if (input.hook_event_name !== "PreToolUse") return { decision: "allow" };
  /** @type {Record<string,string>} */ const tools = guard.tools[ctx.harness];
  const kind = Object.hasOwn(tools, input.tool_name)
    ? tools[input.tool_name]
    : undefined;
  const tool = input.tool_input;
  const command = tool.command;
  const path = tool.file_path;
  if (
    !kind ||
    (kind === "patch" || kind === "shell"
      ? typeof command !== "string"
      : typeof path !== "string")
  )
    return { decision: "allow" };
  const scope = await guardScope(ctx, entry);
  /** @type {[Reason,string][]} */ const found = [];

  /** @param {string} spelled @param {(current:string|null) => boolean} approves */
  async function target(spelled, approves) {
    const at = await ctx.locate(spelled, input.cwd);
    const shown = at.inside ?? spelled;
    if (at.kind === "unresolved" || at.links > 1) found.push(["link", shown]);
    const match =
      at.inside === null ? null : classifySegments(split(at.inside), scope);
    if (!match || match.ancestor) return;
    if (match.area !== "artifact") return void found.push([match.area, shown]);
    /** @type {string|null} */ let current = null;
    try {
      if (at.kind === "file") current = await ctx.readText(shown);
    } catch {
      return void found.push(["unverified", shown]);
    }
    if ((current !== null && declaresApproved(current)) || approves(current))
      found.push(["approved", shown]);
  }

  if (kind === "write" && typeof path === "string") {
    const content = tool.content;
    await target(
      path,
      () => typeof content === "string" && declaresApproved(content),
    );
  } else if (kind === "edit" && typeof path === "string") {
    const [old, next] = [tool.old_string, tool.new_string];
    await target(path, (current) => {
      if (typeof next !== "string") return false;
      if (typeof old !== "string" || !old || !current?.includes(old))
        return approvedLines(next);
      return declaresApproved(
        tool.replace_all === true
          ? current.split(old).join(next)
          : current.replace(old, () => next),
      );
    });
  } else if (kind === "patch" && typeof command === "string") {
    for (const operation of parsePatch(command)) {
      const adds = approvedLines(operation.added.join("\n"));
      await target(operation.path, () => adds);
      if (operation.to !== null) await target(operation.to, () => adds);
    }
  } else if (typeof command === "string") await inspectShell(command);

  /** @param {string} text */
  async function inspectShell(text) {
    const parsed = parseShell(text);
    /** @type {Map<string,import('./runtime-contracts.mjs').PathLocation>} */
    const seen = new Map();
    /** @type {[Reason,string][]} */ const named = [];
    /** @type {Set<string>} */ const doctor = new Set();
    /** @type {(string|null)[]} */ const stack = [];
    /** @type {string|null} */ let cwd = input.cwd;
    let reading = !parsed.dynamic;
    for (const command of parsed.commands) {
      for (; stack.length < command.depth; ) stack.push(cwd);
      for (; stack.length > command.depth; )
        cwd = /** @type {string|null} */ (stack.pop());
      const [program = "", ...args] = programOf(command);
      const remover =
        guard.shell.removers.includes(program) ||
        (program === "find" &&
          args.some((arg) => guard.shell.refused.find.includes(arg)));
      for (const word of command.words)
        for (const spelled of [word, ...word.split("=").slice(1)]) {
          for (const [area, shown, ancestor] of await hits(spelled, cwd, seen))
            if (area === "link" || !ancestor) named.push([area, shown]);
            else if (remover) found.push([area, shown]);
        }
      const [entry] = args;
      const home = scope.installation;
      if (program === "node" && args.length === 1 && home && cwd !== null) {
        const at = await ctx.locate(/** @type {string} */ (entry), cwd);
        const spelled = at.inside && split(at.inside).map(normalizeSegment);
        if (
          spelled &&
          runtime.commands.some(
            (name) => [...home, "hooks", name].join("/") === spelled.join("/"),
          )
        )
          doctor.add(/** @type {string} */ (entry));
      }
      if (!readsOnly(command, (word) => doctor.has(word))) reading = false;
      if (program === "cd" || program === "pushd" || program === "popd") {
        const [dir] = args;
        const fixed = dir !== undefined && !/[$~*?[`]|^-$/.test(dir);
        cwd =
          program !== "popd" && fixed && (cwd !== null || isAbsolute(dir))
            ? resolve(cwd ?? "", dir)
            : null;
      }
    }
    if (!reading) found.push(...named);
  }

  /**
   * Areas a word names: where it lands from the tracked cwd, then its own segments anywhere.
   * @param {string} word @param {string|null} cwd
   * @param {Map<string,import('./runtime-contracts.mjs').PathLocation>} seen
   * @returns {Promise<[Reason,string,boolean][]>}
   */
  async function hits(word, cwd, seen) {
    /** @type {[Reason,string,boolean][]} */ const result = [];
    if (cwd !== null || isAbsolute(word)) {
      const key = `${cwd}\0${word}`;
      const at = seen.get(key) ?? (await ctx.locate(word, cwd ?? input.cwd));
      seen.set(key, at);
      const shown = at.inside ?? word;
      if (at.kind === "unresolved" || at.links > 1)
        result.push(["link", shown, false]);
      const match =
        at.inside === null
          ? at.contains && {
              area: /** @type {const} */ ("audit"),
              ancestor: true,
            }
          : classifySegments(split(at.inside), scope);
      if (match) result.push([match.area, shown, match.ancestor]);
    }
    const parts = split(word);
    for (let i = 0; i < parts.length; i++) {
      const match = classifySegments(parts.slice(i), scope);
      if (match && !match.ancestor) result.push([match.area, word, false]);
    }
    const tail = parts.slice(-2).map(normalizeSegment).join("/");
    if (tail === `${guard.audit}/events.jsonl`)
      result.push(["audit", word, false]);
    return result;
  }

  found.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  const [first] = found;
  if (!first) return { decision: "allow" };
  const [id, why] = reasons[first[0]];
  const shown = first[1].replace(/\p{Cc}/gu, "?").slice(0, 200);
  return {
    decision: "deny",
    reason: `${id}: ${input.tool_name} ${shown}; ${why}`,
  };
}
