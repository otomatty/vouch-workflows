import { parseAgent } from "../../scripts/lib/agents.mjs";

/** @type {import('../../scripts/package.mjs').Render} */
export default function cursorAgent(name, text) {
  const agent = parseAgent(text);
  if (name !== `${agent.name}.md`) throw new Error(`AGENT-FORMAT: ${name}`);
  return [
    name,
    `---\nname: ${agent.name}\ndescription: ${JSON.stringify(agent.description)}\nreadonly: ${!agent.tools.includes("edit")}\n---\n${agent.body}`,
  ];
}
