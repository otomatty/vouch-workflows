import { createHash } from "node:crypto";
import runtime from "../../registry/runtime.json" with { type: "json" };
import { nodeArguments } from "./env.mjs";
import { json } from "./installation-ownership.mjs";
import { projectManual } from "./io.mjs";

/** Snapshot names accepted equally by setup and the distributed diagnostic.
 * @param {unknown} value @param {'registration'|'configuration'} kind @returns {value is string} */
export const isSnapshotName = (value, kind) =>
  typeof value === "string" &&
  new RegExp(
    `^[a-z][a-z-]*\\.${kind === "registration" ? "json" : "toml"}$`,
  ).test(value);

/** Exact installer digest over every archived relative name and UTF-8 content.
 * @param {Record<string,string>} source */
export const distributionDigest = (source) =>
  createHash("sha256")
    .update(
      Object.keys(source)
        .sort()
        .map(
          (path) =>
            `${JSON.stringify(path)}:${createHash("sha256")
              .update(source[path] ?? "")
              .digest("hex")}\n`,
        )
        .join(""),
    )
    .digest("hex");

/** Runtime materialization shared by installer and distributed doctor.
 * @param {Record<string,string>} source @param {string} harness @param {string} referenceRoot */
export function runtimeContents(source, harness, referenceRoot) {
  const prefix = `.${harness}/`;
  /** @type {Record<string,string>} */ const result = {};
  for (const [path, text] of Object.entries(source)) {
    if (
      path !== "AGENTS.md" &&
      !["hooks/", "registry/", "templates/"].some((part) =>
        path.startsWith(`${prefix}${part}`),
      )
    )
      continue;
    const target = path === "AGENTS.md" ? path : path.slice(prefix.length);
    result[target] = path.endsWith(".md")
      ? installedText(text, harness, referenceRoot)
      : text;
  }
  return result;
}

/** Read-only archive validation; all I/O passes through the runtime FileStore.
 * @param {import('./runtime-contracts.mjs').FileStore} files
 * @param {{harness:string,scope:string,digest:string}} state @param {string} runtimeRoot */
export async function verifyManagedRuntime(files, state, runtimeRoot) {
  /** @type {Record<string,string>} */ const source = {};
  /** @param {string} relative */
  async function collect(relative) {
    const at = relative ? `distribution/${relative}` : "distribution";
    const entries = await files.list(at);
    if (entries === null)
      throw new Error("INSTALL-VERSION: archived distribution missing");
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.kind === "directory") await collect(path);
      else {
        if (entry.kind !== "file")
          throw new Error(`INSTALL-LINK: archived ${path}`);
        const text = await files.readText(`distribution/${path}`);
        if (text === null)
          throw new Error(`INSTALL-VERSION: archived file missing: ${path}`);
        source[path] = text;
      }
    }
  }
  await collect("");
  if (distributionDigest(source) !== state.digest)
    throw new Error("INSTALL-VERSION: archived distribution has changed");
  const prefix = `.${state.harness}/`;
  const inventory = json(source[`${prefix}registry/runtime.json`] ?? null);
  if (!Array.isArray(inventory.files) || !source["AGENTS.md"])
    throw new Error("INSTALL-SOURCE: runtime inventory or guidance missing");
  for (const path of runtime.files)
    if (!inventory.files.includes(path) || !source[`${prefix}${path}`])
      throw new Error(`INSTALL-SOURCE: missing mandatory runtime ${path}`);
  for (const path of inventory.files)
    if (typeof path !== "string" || !source[`${prefix}${path}`])
      throw new Error(`INSTALL-SOURCE: missing runtime ${String(path)}`);
  const referenceRoot =
    state.scope === "project"
      ? `.vouch/versions/${state.digest}/${state.harness}`
      : runtimeRoot;
  for (const [path, expected] of Object.entries(
    runtimeContents(source, state.harness, referenceRoot),
  ))
    if ((await files.readText(path)) !== expected)
      throw new Error(`INSTALL-VERSION: runtime has changed: ${path}`);
  return source;
}

/** @param {string} value */
const sh = (value) => `'${value.replaceAll("'", "'\\''")}'`;
/** @param {string} value */
const powershell = (value) => `'${value.replaceAll("'", "''")}'`;

/** Preserve literal POSIX characters, normalizing only Windows separators.
 * @param {string} path @param {NodeJS.Platform} [platform] */
export const nativePath = (path, platform = process.platform) =>
  platform === "win32" ? path.replaceAll("\\", "/") : path;

/** A local Markdown destination, with syntax characters encoded rather than interpreted.
 * @param {string} path @param {NodeJS.Platform} [platform] */
export const markdownDestination = (path, platform = process.platform) =>
  `<${encodeURI(nativePath(path, platform)).replace(/[()#?']/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}>`;

/** Rebind all distributed references and route manual commands through activation.
 * @param {string} text @param {string} harness @param {string} runtimeRoot @param {NodeJS.Platform} [platform] */
export function installedText(
  text,
  harness,
  runtimeRoot,
  platform = process.platform,
) {
  const prefix = `.${harness}`;
  const at = nativePath(runtimeRoot, platform);
  const operations = "doctor|dod|lifecycle|migrate|question|report|statusline";
  const operation = `node ("?)\\.${harness}/hooks/vouch-(${operations})\\.mjs`;
  /** @param {string} action */
  const manual = (action) => {
    if (/^\.vouch\/versions\/[a-f0-9]{64}\/(claude|codex|cursor)$/.test(at))
      return projectManual(action, at);
    const args = nodeArguments(
      `${at}/hooks/vouch-launch.mjs`,
      [action, "manual"],
      platform,
    );
    return `node ${args
      .slice(0, -2)
      .map(platform === "win32" ? powershell : sh)
      .join(" ")} ${action} manual`;
  };
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
        return `](${markdownDestination(`${at}/${link.slice(prefix.length + 1)}`, platform)})`;
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
