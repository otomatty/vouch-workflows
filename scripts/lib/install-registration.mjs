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
  /** @param {string} action @param {boolean} windows */
  const command = (action, windows) => {
    if (harness === "codex" && projectRoot) {
      const target = portable
        ? windows
          ? `"$vouchProjectRoot/${local}"`
          : `"$vouch_project_root/${local}"`
        : (windows ? powershell : sh)(entry);
      if (windows)
        return [
          "$vouchProjectRoot = (Get-Location).ProviderPath",
          "while ($vouchProjectRoot -and !(Test-Path -LiteralPath \"$vouchProjectRoot/vouch/config.json\" -PathType Leaf)) { $vouchParent = [System.IO.Directory]::GetParent($vouchProjectRoot); $vouchProjectRoot = if ($null -eq $vouchParent) { '' } else { $vouchParent.FullName } }",
          "if (!$vouchProjectRoot) { exit 0 }",
          `& node ${target} ${powershell(action)} ${powershell(scope)} "$vouchProjectRoot"`,
        ].join("; ");
      return [
        "vouch_project_root=$(pwd -P)",
        `while [ ! -f "$vouch_project_root/vouch/config.json" ] && [ "$vouch_project_root" != / ]; do vouch_project_root=\${vouch_project_root%/*}; [ -n "$vouch_project_root" ] || vouch_project_root=/; done`,
        '[ -f "$vouch_project_root/vouch/config.json" ] || exit 0',
        `node ${target} ${sh(action)} ${sh(scope)} "$vouch_project_root"`,
      ].join("; ");
    }
    if (
      (harness === "cursor" || action === "statusline") &&
      portable &&
      local !== null &&
      /^\.vouch\/versions\/[a-f0-9]{64}\/(claude|cursor)\/hooks\/vouch-launch\.mjs$/.test(
        local,
      )
    )
      return `node ${local} ${action} ${scope} .`;
    const args = base.map((word, i) => (i === 1 ? action : word));
    const quote = (/** @type {string} */ word) =>
      word.startsWith(`\${${variable}}`)
        ? `"\${${variable}:?${variable} required}${word.slice(variable.length + 3)}"`
        : sh(word);
    const quoteWindows = (/** @type {string} */ word) =>
      word.startsWith(`\${${variable}}`)
        ? `"$env:${variable}${word.slice(variable.length + 3)}"`
        : powershell(word);
    return windows
      ? `& node ${args.map(quoteWindows).join(" ")}`
      : `node ${args.map(quote).join(" ")}`;
  };
  /** @param {string} action */
  const hook = (action) => {
    if (harness === "claude")
      return {
        type: "command",
        command: "node",
        args: base.map((word, i) => (i === 1 ? action : word)),
      };
    return harness === "codex"
      ? {
          type: "command",
          command: command(action, false),
          commandWindows: `${command(action, true)}; exit $LASTEXITCODE`,
        }
      : {
          command: command(action, process.platform === "win32"),
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
    ...(harness === "claude"
      ? {
          statusLine: {
            type: "command",
            command: command("statusline", process.platform === "win32"),
          },
        }
      : {}),
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

/** A local Markdown destination, with syntax characters encoded rather than interpreted.
 * @param {string} path */
export const markdownDestination = (path) =>
  `<${encodeURI(path.replaceAll("\\", "/")).replace(/[()#?']/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}>`;

/** Rebind all distributed references and route manual commands through activation.
 * @param {string} text @param {string} harness @param {string} runtimeRoot */
export function installedText(text, harness, runtimeRoot) {
  const prefix = `.${harness}`;
  const at = runtimeRoot.replaceAll("\\", "/");
  const operations = "doctor|dod|lifecycle|migrate|question|report|statusline";
  const operation = `node ("?)\\.${harness}/hooks/vouch-(${operations})\\.mjs`;
  /** @param {string} action */
  const manual = (action) =>
    `node ${(process.platform === "win32" ? powershell : sh)(`${at}/hooks/vouch-launch.mjs`)} ${action} manual`;
  /** @param {string} value */
  const rebind = (value) =>
    value.replace(
      new RegExp(`${operation}\\1|\\.${harness}/`, "g"),
      (_match, _quote, action) => (action ? manual(action) : `${at}/`),
    );
  text = text.replace(
    new RegExp(
      [
        "`([^`\\r\\n]+)`",
        `\\]\\((\\.${harness}/[^)\\s]+)\\)`,
        `${operation}\\3`,
        `\\.${harness}/`,
      ].join("|"),
      "g",
    ),
    (_match, code, link, _quote, action) => {
      if (code !== undefined) {
        const body = rebind(code);
        const width = Math.max(
          0,
          ...(body.match(/`+/g) ?? []).map((word) => word.length),
        );
        const fence = "`".repeat(width + 1);
        return width ? `${fence} ${body} ${fence}` : `${fence}${body}${fence}`;
      }
      if (link !== undefined)
        return `](${markdownDestination(`${at}/${link.slice(prefix.length + 1)}`)})`;
      return action ? manual(action) : `${at}/`;
    },
  );
  if (harness === "codex" && text.includes("developer_instructions = '''\n"))
    text = text.replace(
      /developer_instructions = '''\n([\s\S]*)'''\n$/,
      (_match, body) => `developer_instructions = ${JSON.stringify(body)}\n`,
    );
  return text;
}
