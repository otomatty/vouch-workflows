import { parseAgent, renderAgent } from "../../scripts/lib/agents.mjs";

// Codex custom agents have no per-tool lists: the contract lines carry them, the sandbox limits writes.
const preamble =
  "Vouch agent contract: use only the listed tools; never use a disallowed tool or operation.";
const basic = String.raw`"(?:[^"\\\n]|\\.)*"`;
const shape = new RegExp(
  `^# Generated from core/agents/[a-z-]+\\.md by scripts/package\\.mjs\\. Edit the source, not this file\\.\\nname = (${basic})\\ndescription = (${basic})\\nsandbox_mode = "(read-only|workspace-write)"\\ndeveloper_instructions = '''\\n([\\s\\S]*)'''\\n$`,
);

const sandbox = (agent: { tools: string[] }) =>
  agent.tools.includes("edit") ? "workspace-write" : "read-only";

function string(text: string): string {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AGENT-TOML: unsupported string escape");
  }
}

/** TOML agent: JSON-compatible basic strings and one multi-line literal string. */
const codexAgent: import("../../scripts/package.mjs").Render = (name, text) => {
  if (!name.endsWith(".md")) throw new Error(`AGENT-FORMAT: ${name}`);
  const agent = parseAgent(text);
  if (name !== `${agent.name}.md`)
    throw new Error(`AGENT-FORMAT: ${name} is not ${agent.name}.md`);
  if (agent.body.includes("'''"))
    throw new Error("AGENT-TOML: the body cannot contain '''");
  return [
    `${agent.name}.toml`,
    [
      `# Generated from core/agents/${name} by scripts/package.mjs. Edit the source, not this file.`,
      `name = ${JSON.stringify(agent.name)}`,
      `description = ${JSON.stringify(agent.description)}`,
      `sandbox_mode = "${sandbox(agent)}"`,
      "developer_instructions = '''",
      preamble,
      `inputs: ${agent.inputs.join(", ")}`,
      `tools: ${agent.tools.join(", ")}`,
      `disallowed: ${agent.disallowed.join(", ")}`,
      `${agent.body}'''`,
      "",
    ].join("\n"),
  ];
};

/** Exact inverse of codexAgent for the generated subset (DIST-4). */
export function fromToml(toml: string): string {
  const match = shape.exec(toml);
  if (!match?.[1] || !match[2] || !match[4])
    throw new Error("AGENT-TOML: outside the generated subset");
  const [first, inputs, tools, disallowed, ...rest] = match[4].split("\n");
  const items = (line: string | undefined, key: string) => {
    if (!line?.startsWith(`${key}: `))
      throw new Error(`AGENT-TOML: missing ${key} line`);
    return line.slice(key.length + 2).split(", ");
  };
  if (first !== preamble) throw new Error("AGENT-TOML: changed preamble");
  const source = renderAgent({
    name: string(match[1]),
    inputs: items(inputs, "inputs"),
    tools: items(tools, "tools"),
    disallowed: items(disallowed, "disallowed"),
    body: rest.join("\n"),
  });
  const agent = parseAgent(source);
  if (
    agent.name !== string(match[1]) ||
    agent.description !== string(match[2]) ||
    sandbox(agent) !== match[3] ||
    !toml.startsWith(`# Generated from core/agents/${agent.name}.md `)
  )
    throw new Error("AGENT-TOML: fields disagree with the instructions");
  return source;
}

export default codexAgent;
