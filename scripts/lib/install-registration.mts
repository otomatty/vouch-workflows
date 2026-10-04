import { isAbsolute, join, relative } from "node:path";

/** Design D6: characters that no shell reads alike inside a double-quoted word. */
export function assertQuotable(path: string) {
  if (
    /["$`%<>\n\r]/.test(path) ||
    (process.platform !== "win32" && path.includes("\\"))
  )
    throw new Error(
      `INSTALL-PATH: ${path} contains characters hook commands cannot quote in every shell`,
    );
}

/** Walks up from the working directory to a project-relative launcher; no variables, quotes or `$`. */
const findUp =
  "const p=require('path'),f=require('fs');const r=process.argv[1];for(let d=process.cwd();;){const c=p.join(d,r);if(f.existsSync(c)){process.argv.splice(1,1,c);import(require('url').pathToFileURL(c).href);break}const u=p.dirname(d);if(u===d){console.error('VOUCH-LAUNCH: launcher not found: '+r);process.exit(1)}d=u}";

/** One command that sh, Git Bash, PowerShell and cmd all run the same way. */
export function launchCommand(entry: string, words: string[]) {
  const path = entry.replaceAll("\\", "/");
  const launcher = isAbsolute(entry) ? `"${path}"` : `-e "${findUp}" "${path}"`;
  return `node ${launcher} ${words.join(" ")}`;
}

/** Project registrations only (design D3); the launcher finds the project itself. */
export function registration(
  harness: string,
  runtimeRoot: string,
  projectRoot: string,
) {
  const entry = join(runtimeRoot, "hooks/vouch-launch.mjs");
  const local = relative(projectRoot, entry).replaceAll("\\", "/");
  const inside = !isAbsolute(local) && !local.startsWith("../");
  const hook = (action: string) => {
    // Claude expands its own variable in args without a shell.
    if (harness === "claude")
      return {
        type: "command",
        command: "node",
        args: [
          inside ? `\${CLAUDE_PROJECT_DIR}/${local}` : entry,
          action,
          "project",
          `\${CLAUDE_PROJECT_DIR}`,
        ],
      };
    const command = launchCommand(inside ? local : entry, [action, "project"]);
    // PowerShell reports a native exit code only when asked to; Cursor reads JSON, not codes.
    return harness === "codex"
      ? {
          type: "command",
          command,
          commandWindows: `${command}; exit $LASTEXITCODE`,
        }
      : { command };
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
      launchCommand(`${at}/hooks/vouch-launch.mjs`, [action, "manual"]),
  );
  text = text.replaceAll(`${prefix}/`, `${at}/`);
  if (harness === "codex" && text.includes("developer_instructions = '''\n"))
    text = text.replace(
      /developer_instructions = '''\n([\s\S]*)'''\n$/,
      (_match, body) => `developer_instructions = ${JSON.stringify(body)}\n`,
    );
  return text;
}
