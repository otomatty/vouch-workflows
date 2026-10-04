import { elapsedMilliseconds, sha256Hex } from "./clock.mjs";
export type Entry = { path: string; sha256: string; updated: string };
export type Index = {
  version: 1;
  generation: string;
  scope: "diff" | "full";
  entries: Entry[];
};
export type Context = import("./contracts.mjs").ReadyHookContext;
export const layers = ["codekb", "diagrams", "design", "infra", "background"];
export const digest = (text: string) => sha256Hex(Buffer.from(text));
const local = (path: string) =>
  !!path && !/^(?:[/\\]|[A-Za-z]:)|(?:^|[/\\])\.\.(?:[/\\]|$)/.test(path);
export const dated = (day: unknown, ctx: Context) =>
  typeof day === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  elapsedMilliseconds(`${day}T00:00:00Z`, ctx.now()) !== null;
export function updated(text: string) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? "";
  const dates = [...front.matchAll(/^updated: (\d{4}-\d{2}-\d{2})\r?$/gm)];
  return dates.length === 1 ? dates[0]?.[1] : null;
}
export async function read(path: string, ctx: Context) {
  if (!local(path)) throw new Error(`boundary: ${path}`);
  const text = await ctx.readText(path);
  if (text === null) throw new Error(`missing: ${path}`);
  return text;
}
export function section(text: string, marker: string) {
  const parts = text.split(`<!-- ${marker} -->`);
  return parts.length === 2
    ? ((parts[1] ?? "").split(/<!-- (?:sec|question):|\n### /)[0]?.trim() ?? "")
    : "";
}
export const links = (text: string) =>
  [...text.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)].map((m) => m[1] ?? "");
export const filled = (text: string) =>
  !!text.trim() &&
  !/未記入|未決定|\b(?:unfilled|undecided|TODO|TBD)\b/i.test(text);
