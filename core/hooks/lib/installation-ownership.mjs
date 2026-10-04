import { isAbsolute, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { nodeArguments } from "./env.mjs";
import { removeCodex } from "./installation-toml.mjs";

/** @typedef {Record<string,unknown>} ObjectValue */
/** @param {unknown} value @returns {value is ObjectValue} */
export const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** @param {string|null} text @returns {ObjectValue} */
export function json(text) {
  const value = text === null ? {} : JSON.parse(text);
  if (!object(value)) throw new Error("INSTALL-CONFIG: expected JSON object");
  return value;
}
/** @param {unknown} value */
export const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** @param {string|null} text @param {string} harness @param {string} body */
export function block(text, harness, body) {
  if (text?.includes(`<!-- vouch:${harness}:start -->`))
    throw new Error("INSTALL-CONFLICT: unmanaged Vouch block");
  return `${text && !text.endsWith("\n") ? "\n" : ""}\n<!-- vouch:${harness}:start -->\n${body}\n<!-- vouch:${harness}:end -->\n`;
}

/** Require the complete project activation set independently of the recorded list.
 * @param {Record<string,string>} source @param {string} harness @param {unknown[]} owned @param {boolean} [projectActivation] */
export function verifyActivationManifest(
  source,
  harness,
  owned,
  projectActivation = true,
) {
  const skills =
    harness === "codex" ? ".agents/skills/" : `.${harness}/skills/`;
  const expected = new Map([
    [
      `.${harness}/${harness === "claude" ? "settings" : "hooks"}.json`,
      "hooks",
    ],
    [`${skills}vouch/SKILL.md`, "file"],
  ]);
  if (projectActivation) expected.set("AGENTS.md", "block");
  for (const path of Object.keys(source))
    if (path.startsWith(skills) || path.startsWith(`.${harness}/agents/`))
      expected.set(path, "file");
  if (projectActivation && harness === "claude")
    expected.set("CLAUDE.md", "block");
  if (harness === "codex") expected.set(".codex/config.toml", "toml");
  if (projectActivation && harness === "cursor")
    expected.set(".cursor/rules/vouch.mdc", "file");
  if (
    owned.length !== expected.size ||
    [...expected].some(
      ([path, kind]) =>
        owned.filter(
          (entry) =>
            object(entry) && entry.path === path && entry.kind === kind,
        ).length !== 1,
    )
  )
    throw new Error(
      "INSTALL-STATE: incomplete or invalid activation ownership manifest",
    );
}

/** Remove only owned entries; unrelated changes stay intact.
 * @param {string|null} text @param {string} content @param {string|null} previous */
function removeHooks(text, content, previous) {
  const actual = json(text);
  const contribution = json(content);
  const before = json(previous);
  if (!object(actual.hooks) || !object(contribution.hooks))
    throw new Error("INSTALL-CONFLICT: owned hooks missing");
  const hooks = { ...actual.hooks };
  for (const [event, entries] of Object.entries(contribution.hooks)) {
    const remaining = hooks[event];
    if (!Array.isArray(remaining) || !Array.isArray(entries))
      throw new Error("INSTALL-CONFLICT: owned hooks changed");
    const kept = [...remaining];
    for (const entry of entries) {
      if (kept.filter((item) => isDeepStrictEqual(item, entry)).length !== 1)
        throw new Error("INSTALL-CONFLICT: owned hook duplicated or missing");
      const index = kept.findIndex((item) => isDeepStrictEqual(item, entry));
      if (index < 0)
        throw new Error("INSTALL-CONFLICT: owned hook changed or removed");
      kept.splice(index, 1);
    }
    if (
      kept.length ||
      (object(before.hooks) && Object.hasOwn(before.hooks, event))
    )
      hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length || Object.hasOwn(before, "hooks"))
    actual.hooks = hooks;
  else delete actual.hooks;
  for (const [key, value] of Object.entries(contribution)) {
    if (key === "hooks") continue;
    if (!isDeepStrictEqual(actual[key], value))
      throw new Error(`INSTALL-CONFLICT: owned ${key} changed`);
    if (Object.hasOwn(before, key)) actual[key] = before[key];
    else delete actual[key];
  }
  return isDeepStrictEqual(actual, before) ? previous : pretty(actual);
}

/** @param {string|null} text @param {string} content @param {string|null} previous */
function removeBlock(text, content, previous) {
  if (
    text === null ||
    !text.includes(content) ||
    text.indexOf(content) !== text.lastIndexOf(content)
  )
    throw new Error("INSTALL-CONFLICT: owned documentation block changed");
  const after = text.replace(content, "");
  return after === (previous ?? "") ? previous : after;
}

/** Validate and restore only an owned contribution; callers may discard the result.
 * @param {string|null} text @param {unknown} entry @returns {string|null} */
export function restoreOwned(text, entry) {
  if (
    !object(entry) ||
    typeof entry.path !== "string" ||
    typeof entry.content !== "string" ||
    (entry.previous !== null && typeof entry.previous !== "string") ||
    !["file", "block", "hooks", "toml"].includes(String(entry.kind))
  )
    throw new Error("INSTALL-STATE: invalid owned entry");
  if (entry.kind === "file") {
    if (text !== entry.content)
      throw new Error(`INSTALL-CONFLICT: ${entry.path}`);
    return entry.previous;
  }
  if (entry.kind === "block")
    return removeBlock(text, entry.content, entry.previous);
  if (entry.kind === "hooks")
    return removeHooks(text, entry.content, entry.previous);
  return removeCodex(text, entry.content, entry.previous);
}

/** @param {string} value */
const sh = (value) => `'${value.replaceAll("'", "'\\''")}'`;
/** @param {string} value */
const powershell = (value) => `'${value.replaceAll("'", "''")}'`;

/** @param {string} harness @param {string} runtimeRoot @param {string} scope @param {string|undefined} projectRoot @param {NodeJS.Platform} [platform] */
export function registration(
  harness,
  runtimeRoot,
  scope,
  projectRoot,
  platform = process.platform,
) {
  const entry = join(runtimeRoot, "hooks/vouch-launch.mjs");
  const variable =
    harness === "claude"
      ? "CLAUDE_PROJECT_DIR"
      : harness === "cursor"
        ? "CURSOR_PROJECT_DIR"
        : "VOUCH_PROJECT_ROOT";
  const local = projectRoot
    ? platform === "win32"
      ? relative(projectRoot, entry).replaceAll("\\", "/")
      : relative(projectRoot, entry)
    : null;
  const portable =
    local !== null && !isAbsolute(local) && !local.startsWith("../");
  /** @param {string} action @param {NodeJS.Platform} targetPlatform */
  const argumentsFor = (action, targetPlatform) =>
    nodeArguments(
      portable ? `\${${variable}}/${local}` : entry,
      [action, scope, ...(projectRoot ? [`\${${variable}}`] : [])],
      targetPlatform,
      runtimeRoot.includes("\\"),
    );
  /** @param {string} action @param {boolean} windows */
  const command = (action, windows) => {
    const prefix = [
      "node",
      ...nodeArguments(entry, [], windows ? "win32" : "linux")
        .slice(0, -1)
        .map(sh),
    ].join(" ");
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
        `${prefix} ${target} ${sh(action)} ${sh(scope)} "$vouch_project_root"`,
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
      return `${prefix} ${local} ${action} ${scope} .`;
    if (action === "statusline" && windows) {
      const encoded = Buffer.from(
        JSON.stringify({ entry, scope, project: Boolean(projectRoot) }),
      ).toString("base64");
      // Only fixed JavaScript and base64 reach the shell; paths are decoded inside Node.
      return `node -e "const v=JSON.parse(Buffer.from('${encoded}','base64').toString());process.argv=[process.execPath,v.entry,'statusline',v.scope];if(v.project)process.argv.push(process.env.CLAUDE_PROJECT_DIR||'');import(require('node:url').pathToFileURL(v.entry).href)"`;
    }
    const args = argumentsFor(action, windows ? "win32" : "linux");
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
        args: argumentsFor(action, platform),
      };
    return harness === "codex"
      ? {
          type: "command",
          command: command(action, false),
          commandWindows: `${command(action, true)}; exit $LASTEXITCODE`,
        }
      : {
          command: command(action, platform === "win32"),
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
            command: command("statusline", platform === "win32"),
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
