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
    if (action === "statusline" && windows) {
      const encoded = Buffer.from(
        JSON.stringify({ entry, scope, project: Boolean(projectRoot) }),
      ).toString("base64");
      // Only fixed JavaScript and base64 reach the shell; paths are decoded inside Node.
      return `node -e "const v=JSON.parse(Buffer.from('${encoded}','base64').toString());process.argv=[process.execPath,v.entry,'statusline',v.scope];if(v.project)process.argv.push(process.env.CLAUDE_PROJECT_DIR||'');import(require('node:url').pathToFileURL(v.entry).href)"`;
    }
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

export {
  installedText,
  markdownDestination,
} from "../../core/hooks/lib/installation-runtime.mjs";
