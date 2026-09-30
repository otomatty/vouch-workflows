/** Agent sources in core/agents; see docs/development/agents.md.
 * @typedef {{name:string,inputs:string[],tools:string[],disallowed:string[],description:string,body:string}} Agent
 */
import documents from "../../core/registry/project-documents.json" with {
  type: "json",
};

/** Harness-neutral tools; each agent allows or disallows every word once. */
export const TOOLS = ["read", "edit", "shell", "web", "delegate", "ask"];
/** Artifacts, rules, knowledge, the commit-ordered diff and the working tree code. */
export const INPUTS = [
  ...Object.values(documents.artifacts),
  documents.decisions,
  documents.audit,
  "vouch/rules.md",
  "vouch/knowledge/",
  "diff",
  "repository",
];

const header =
  /^---\nname: (vouch-[a-z]+)\ninputs: \[([^\]\n]*)\]\ntools: \[([^\]\n]*)\]\ndisallowed: \[([^\]\n]*)\]\n---\n/;

/** @param {string} reason @returns {never} */
function reject(reason) {
  throw new Error(`AGENT-FORMAT: ${reason}`);
}

/** @param {string|undefined} text @param {string} key */
function list(text, key) {
  const items = (text ?? "").split(", ");
  if (!items.every((item) => /^[a-z0-9._/-]+$/.test(item)))
    reject(`${key} must be a one-line list of lowercase words`);
  if (new Set(items).size !== items.length) reject(`${key} repeats an item`);
  return items;
}

/** Canonical source only: fixed key order, one-line lists, `# name` then a summary line.
 * @param {string} text @returns {Agent}
 */
export function parseAgent(text) {
  const control = [...text].some((c) => {
    const code = c.charCodeAt(0);
    return (code < 32 && c !== "\t" && c !== "\n") || code === 127;
  });
  if (control) reject("control characters or CR are not allowed");
  if (!text.endsWith("\n")) reject("missing final newline");
  const match = header.exec(text);
  if (!match?.[1])
    reject("frontmatter must be name, inputs, tools, disallowed");
  const name = match[1];
  const inputs = list(match[2], "inputs");
  const tools = list(match[3], "tools");
  const disallowed = list(match[4], "disallowed");
  const unknown = [
    ...inputs.filter((item) => !INPUTS.includes(item)),
    ...tools.filter((item) => !TOOLS.includes(item)),
  ];
  if (unknown.length) reject(`unknown ${unknown.join(", ")}`);
  const split = TOOLS.filter(
    (tool) => tools.includes(tool) === disallowed.includes(tool),
  );
  if (split.length) reject(`allow or disallow once: ${split.join(", ")}`);
  const body = text.slice(match[0].length);
  const summary = /^\n# (\S+)\n\n([^#\n][^\n]*)\n\n/.exec(body);
  if (summary?.[1] !== name || !summary[2])
    reject("body must start with `# <name>` and a summary line");
  return { name, inputs, tools, disallowed, description: summary[2], body };
}

/** @param {Omit<Agent,'description'>} agent */
export function renderAgent(agent) {
  return [
    "---",
    `name: ${agent.name}`,
    `inputs: [${agent.inputs.join(", ")}]`,
    `tools: [${agent.tools.join(", ")}]`,
    `disallowed: [${agent.disallowed.join(", ")}]`,
    `---\n${agent.body}`,
  ].join("\n");
}
