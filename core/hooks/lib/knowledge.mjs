import { elapsedMilliseconds, sha256Hex } from "./clock.mjs";
/** @typedef {{path:string,sha256:string,updated:string}} Entry
 * @typedef {{version:1,generation:string,scope:'diff'|'full',entries:Entry[]}} Index
 * @typedef {import('./contracts.mjs').ReadyHookContext} Context */
export const layers = ["codekb", "diagrams", "design", "infra", "background"];
export const digest = (/** @type {string} */ text) =>
  sha256Hex(Buffer.from(text));
/** @param {string} path */
const local = (path) =>
  !!path && !/^(?:[/\\]|[A-Za-z]:)|(?:^|[/\\])\.\.(?:[/\\]|$)/.test(path);
/** @param {unknown} day @param {Context} ctx */
export const dated = (day, ctx) =>
  typeof day === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  elapsedMilliseconds(`${day}T00:00:00Z`, ctx.now()) !== null;
/** @param {string} text */
export function updated(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? "";
  const dates = [...front.matchAll(/^updated: (\d{4}-\d{2}-\d{2})\r?$/gm)];
  return dates.length === 1 ? dates[0]?.[1] : null;
}
/** @param {string} path @param {Context} ctx */
export async function read(path, ctx) {
  if (!local(path)) throw new Error(`boundary: ${path}`);
  const text = await ctx.readText(path);
  if (text === null) throw new Error(`missing: ${path}`);
  return text;
}
/** @param {string} text @param {string} marker */
export function section(text, marker) {
  const parts = text.split(`<!-- ${marker} -->`);
  return parts.length === 2
    ? ((parts[1] ?? "").split(/<!-- (?:sec|question):|\n### /)[0]?.trim() ?? "")
    : "";
}
/** @param {string} text */
export const links = (text) =>
  [...text.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)].map((m) => m[1] ?? "");
/** @param {string} text */
export const filled = (text) =>
  !!text.trim() &&
  !/未記入|未決定|\b(?:unfilled|undecided|TODO|TBD)\b/i.test(text);
