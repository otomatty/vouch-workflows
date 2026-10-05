import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import guard from "../../registry/write-guard.json" with { type: "json" };
import { normalizeSegment } from "./areas.mjs";

export async function guardScope(
  ctx: import("./contracts.mjs").ReadyHookContext,
  entry: string,
): Promise<import("./runtime-contracts.mjs").GuardScope> {
  const hook = entry.startsWith("file:") ? fileURLToPath(entry) : entry;
  const root = await ctx.locate(dirname(dirname(hook)));
  const managed = /(?:^|[/\\])\.vouch[/\\]versions[/\\]/.test(hook)
    ? {
        managed: `.${ctx.harness}`,
        runtime: resolve(dirname(hook)),
        runtimeRoot: root.canonical,
      }
    : {};
  const home = root.inside;
  if (!home) return { installation: null, installed: [], ...managed };
  let installed = ["*"];
  try {
    const value = JSON.parse(
      (await ctx.readText(`${home}/registry/installation.json`)) ?? "",
    );
    const names = [
      value.registration,
      ...(value.configuration === undefined ? [] : [value.configuration]),
      ...(value.overrides ?? []),
    ];
    if (
      Array.isArray(value.overrides ?? []) &&
      names.every((name) => typeof name === "string")
    )
      installed = [...guard.installation, ...names];
  } catch {
    // An unreadable descriptor protects the whole installation directory.
  }
  return {
    installation: home.replaceAll("\\", "/").split("/").map(normalizeSegment),
    installed: installed.map(normalizeSegment),
    ...managed,
  };
}
