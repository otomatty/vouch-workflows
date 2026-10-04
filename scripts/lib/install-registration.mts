import { isAbsolute, join, relative } from "node:path";

const sh = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const powershell = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function registration(
  harness: string,
  runtimeRoot: string,
  scope: string,
  projectRoot: string | undefined,
) {
  const entry = join(runtimeRoot, "hooks/vouch-launch.mjs");
  const variable =
    harness === "claude"
      ? "CLAUDE_PROJECT_DIR"
      : harness === "cursor"
        ? "CURSOR_PROJECT_DIR"
        : "VOUCH_PROJECT_ROOT";
  const local = projectRoot
    ? relative(projectRoot, entry).replaceAll("\\", "/")
    : null;
  const portable =
    local !== null && !isAbsolute(local) && !local.startsWith("../");
  const base = [
    portable ? `\${${variable}}/${local}` : entry,
    "",
    scope,
    ...(projectRoot ? [`\${${variable}}`] : []),
  ];
  const hook = (action: string) => {
    const args = base.map((word, i) => (i === 1 ? action : word));
    if (harness === "claude") return { type: "command", command: "node", args };
    const quote = (word: string) =>
      word.startsWith(`\${${variable}}`)
        ? `"\${${variable}:?${variable} required}${word.slice(variable.length + 3)}"`
        : sh(word);
    const quoteWindows = (word: string) =>
      word.startsWith(`\${${variable}}`)
        ? `"$env:${variable}${word.slice(variable.length + 3)}"`
        : powershell(word);
    const command = `node ${args.map(quote).join(" ")}`;
    return harness === "codex"
      ? {
          type: "command",
          command,
          commandWindows: `& node ${args.map(quoteWindows).join(" ")}; exit $LASTEXITCODE`,
        }
      : {
          command:
            process.platform === "win32"
              ? `& node ${args.map(quoteWindows).join(" ")}`
              : command,
        };
  };
  if (harness === "cursor")
    return {
      version: 1,
      hooks: {
        sessionStart: [hook("session")],
        beforeSubmitPrompt: [hook("prompt")],
        preToolUse: [hook("guard")],
        afterAgentResponse: [hook("stop")],
        stop: [hook("stop")],
      },
    };
  return {
    hooks: {
      SessionStart: [
        { matcher: "startup|resume|clear|compact", hooks: [hook("session")] },
      ],
      UserPromptSubmit: [{ hooks: [hook("prompt")] }],
      PreToolUse: [
        {
          matcher:
            harness === "claude" ? "Write|Edit|Bash" : "apply_patch|Bash",
          hooks: [hook("guard")],
        },
      ],
      Stop: [{ hooks: [hook("stop")] }],
    },
  };
}

export const nativeDirectory = (harness: string) => `.${harness}`;
export const skillsDirectory = (harness: string) =>
  harness === "codex" ? ".agents/skills" : `.${harness}/skills`;
export const registrationPath = (harness: string) =>
  `${nativeDirectory(harness)}/${harness === "claude" ? "settings.json" : "hooks.json"}`;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Design D4: the only paths an installation may create, edit or restore, by kind. */
export function managedPath(harness: string, kind: string, path: string) {
  const codexConfig = harness === "codex" && path === ".codex/config.toml";
  if (kind === "hooks") return path === registrationPath(harness);
  if (kind === "toml") return codexConfig;
  if (kind === "block")
    return (
      path === "AGENTS.md" ||
      (harness === "claude" && path === "CLAUDE.md") ||
      codexConfig
    );
  if (kind !== "file") return false;
  const owned = new RegExp(
    `^(?:${escaped(skillsDirectory(harness))}|${escaped(nativeDirectory(harness))}/agents)/vouch[\\w.-]*(?:/\\w[\\w.-]*)*$`,
  );
  return (
    codexConfig ||
    (harness === "cursor" && path === ".cursor/rules/vouch.mdc") ||
    owned.test(path)
  );
}

/** Rebind all distributed references and route manual commands through activation. */
export function installedText(
  text: string,
  harness: string,
  runtimeRoot: string,
) {
  const prefix = `.${harness}`;
  const at = runtimeRoot.replaceAll("\\", "/");
  const operations = "doctor|dod|lifecycle|migrate|question|report|statusline";
  text = text.replace(
    new RegExp(
      `node ("?)\\.${harness}/hooks/vouch-(${operations})\\.mjs\\1`,
      "g",
    ),
    (_match, _quote, action) =>
      `node ${(process.platform === "win32" ? powershell : sh)(`${at}/hooks/vouch-launch.mjs`)} ${action} manual`,
  );
  text = text.replaceAll(`${prefix}/`, `${at}/`);
  if (harness === "codex" && text.includes("developer_instructions = '''\n"))
    text = text.replace(
      /developer_instructions = '''\n([\s\S]*)'''\n$/,
      (_match, body) => `developer_instructions = ${JSON.stringify(body)}\n`,
    );
  return text;
}
