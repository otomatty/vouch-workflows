import { parseAgent, TOOLS } from "../../scripts/lib/agents.mjs";

/** Claude tool names per vocabulary word (subagent `tools` / `disallowedTools`). */
const names = /** @type {Record<string,string[]>} */ ({
  read: ["Read", "Grep", "Glob"],
  edit: ["Edit", "Write"],
  shell: ["Bash"],
  web: ["WebFetch", "WebSearch"],
  delegate: ["Agent"],
  ask: ["AskUserQuestion"],
});
/** The builder works each Unit in its own worktree (decision record §15). */
const isolation = /** @type {Record<string,string>} */ ({
  "vouch-builder": "worktree",
});

/** @param {string[]} words */
const tools = (words) =>
  words
    .filter((word) => TOOLS.includes(word))
    .flatMap((word) => names[word] ?? [])
    .join(", ");

/** Claude agent Markdown; the body stays byte-for-byte.
 * @type {import('../../scripts/package.mjs').Render}
 */
export default function claudeAgent(name, text) {
  const agent = parseAgent(text);
  if (name !== `${agent.name}.md`)
    throw new Error(`AGENT-FORMAT: ${name} is not ${agent.name}.md`);
  const lines = [
    "---",
    `name: ${agent.name}`,
    `description: ${JSON.stringify(agent.description)}`,
    `tools: ${tools(agent.tools)}`,
    `disallowedTools: ${tools(agent.disallowed)}`,
  ];
  const mode = isolation[agent.name];
  if (mode) lines.push(`isolation: ${mode}`);
  return [name, `${lines.join("\n")}\n---\n${agent.body}`];
}
