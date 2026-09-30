import { sha256Hex } from "../../core/hooks/lib/clock.mjs";
export const head = "a".repeat(40);
export const date = "2026-09-27";
export const paths = [
  "codekb/code",
  "diagrams/components",
  "design/contracts",
  "infra/environment",
  "background/project",
]
  .map((p) => `vouch/knowledge/${p}.md`)
  .concat("vouch/rules.md");
export const document = `---\nupdated: ${date}\n---\n<!-- sec:main -->\n# Main\n`;
/** @param {string} text */
export const digest = (text) => sha256Hex(Buffer.from(text));
export function knowledgeFiles() {
  const index = {
    version: 1,
    generation: head,
    scope: "diff",
    entries: paths.map((path) => ({
      path,
      sha256: digest(document),
      updated: date,
    })),
  };
  return {
    ...Object.fromEntries(paths.map((path) => [path, document])),
    "vouch/knowledge/index.json": JSON.stringify(index),
  };
}
export const citation = `[basis](${paths[0]}#main@${date})`;
export const artifact = `<!-- sec:references -->\n${citation}\n`;
export const question = `### Q-1: Choice
<!-- question:situation -->
We need a choice. ${citation}
<!-- question:options -->
| Option <!-- option:option --> | Benefits <!-- option:benefits --> | Drawbacks <!-- option:drawbacks --> | Basis <!-- option:basis --> |
| --- | --- | --- | --- |
| A | Small | Limited | ${citation} |
| B | Broad | Complex | ${citation} |
<!-- question:recommendation -->
A because it is small.
<!-- question:default -->
A if unanswered.
<!-- question:impact -->
U1 continues.
<!-- question:answer -->
Unanswered.
`;
