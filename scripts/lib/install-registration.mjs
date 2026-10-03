import { isAbsolute, join, relative } from "node:path";

/** @param {string} value */
const sh = (value) => `'${value.replaceAll("'", "'\\''")}'`;
/** @param {string} value */
const powershell = (value) => `'${value.replaceAll("'", "''")}'`;

/** @param {string} harness @param {string} runtimeRoot @param {string} scope @param {string|undefined} projectRoot */
export function registration(harness, runtimeRoot, scope, projectRoot) {
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
  /** @param {string} action */
  const hook = (action) => {
    const args = base.map((word, i) => (i === 1 ? action : word));
    if (harness === "claude") return { type: "command", command: "node", args };
    const quote = (/** @type {string} */ word) =>
      word.startsWith(`\${${variable}}`)
        ? `"\${${variable}:?${variable} required}${word.slice(variable.length + 3)}"`
        : sh(word);
    const quoteWindows = (/** @type {string} */ word) =>
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

/** @param {string} harness */
export const nativeDirectory = (harness) => `.${harness}`;
/** @param {string} harness */
export const skillsDirectory = (harness) =>
  harness === "codex" ? ".agents/skills" : `.${harness}/skills`;
/** @param {string} harness */
export const registrationPath = (harness) =>
  `${nativeDirectory(harness)}/${harness === "claude" ? "settings.json" : "hooks.json"}`;

/** Rebind all distributed references and route manual commands through activation.
 * @param {string} text @param {string} harness @param {string} runtimeRoot */
export function installedText(text, harness, runtimeRoot) {
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
