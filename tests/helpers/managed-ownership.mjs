/** Independent complete activation fixtures for the three native layouts.
 * @param {'claude'|'codex'|'cursor'} harness */
export function managedOwned(harness) {
  const layouts = {
    claude: {
      file: [".claude/skills/vouch/SKILL.md", ".claude/agents/check.md"],
      block: ["AGENTS.md", "CLAUDE.md"],
      toml: [],
    },
    codex: {
      file: [".agents/skills/vouch/SKILL.md", ".codex/agents/check.toml"],
      block: ["AGENTS.md"],
      toml: [".codex/config.toml"],
    },
    cursor: {
      file: [
        ".cursor/skills/vouch/SKILL.md",
        ".cursor/agents/check.md",
        ".cursor/rules/vouch.mdc",
      ],
      block: ["AGENTS.md"],
      toml: [],
    },
  };
  return Object.entries(layouts[harness]).flatMap(([kind, paths]) =>
    paths.map((path) => ({
      path,
      kind,
      content: kind === "toml" ? "[]\n" : `fixture ${path}`,
      previous: null,
    })),
  );
}
