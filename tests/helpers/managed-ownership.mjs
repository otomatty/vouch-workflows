import { activationGuidance } from "../../core/hooks/lib/installation-contributions.mjs";
import { block } from "../../core/hooks/lib/installation-ownership.mjs";
/** Complete activation fixtures for the three native layouts.
 * @param {'claude'|'codex'|'cursor'} harness @param {string} [referenceRoot] */
export function managedOwned(harness, referenceRoot = "fixture-runtime") {
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
      content:
        kind === "toml"
          ? "[]\n"
          : kind === "block"
            ? block(
                null,
                harness,
                activationGuidance(harness, referenceRoot).find(
                  (item) => item.path === path,
                )?.content ?? "",
              )
            : path === ".cursor/rules/vouch.mdc"
              ? (activationGuidance(harness, referenceRoot).find(
                  (item) => item.path === path,
                )?.content ?? "")
              : "fixture activation file",
      previous:
        kind === "toml"
          ? "[features]\nhooks = true\n[agents]\nmax_depth = 3\n"
          : null,
    })),
  );
}
