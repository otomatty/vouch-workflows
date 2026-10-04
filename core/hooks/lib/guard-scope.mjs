import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import guard from "../../registry/write-guard.json" with { type: "json" };
import { nativeRegistrationNames, normalizeSegment } from "./areas.mjs";

/** @param {import('./contracts.mjs').ReadyHookContext} ctx @param {string} entry
 * @returns {Promise<import('./runtime-contracts.mjs').GuardScope>} */
export async function guardScope(ctx, entry) {
  const hook = entry.startsWith("file:") ? fileURLToPath(entry) : entry;
  const runtimeRoot = dirname(dirname(hook));
  const location = await ctx.locate(runtimeRoot);
  const managed = /(?:^|[/\\])\.vouch[/\\]versions[/\\]/.test(hook)
    ? {
        managed: `.${ctx.harness}`,
        runtime: resolve(dirname(hook)),
        ...(location.outside ? { externalRuntime: location.outside } : {}),
        nativeRegistrations: await Promise.all(
          (nativeRegistrationNames[`.${ctx.harness}`] ?? []).map((name) =>
            ctx.locate(
              resolve(runtimeRoot, "../../../..", `.${ctx.harness}`, name),
            ),
          ),
        ),
      }
    : {};
  const home = location.inside;
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

/** @param {string} root @param {string} target */
function contains(root, target) {
  const part = relative(root, target);
  return !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
}

/** Canonical managed paths retain protection through aliases and junctions.
 * @param {import('./runtime-contracts.mjs').PathLocation} at
 * @param {import('./runtime-contracts.mjs').GuardScope} scope
 * @returns {import('./runtime-contracts.mjs').GuardMatch|null} */
export function externalRuntimeMatch(at, scope) {
  if (at.outside && scope.externalRuntime) {
    if (contains(scope.externalRuntime, at.outside))
      return { area: "installation", ancestor: false };
    if (contains(at.outside, scope.externalRuntime))
      return { area: "installation", ancestor: true };
  }
  for (const registration of scope.nativeRegistrations ?? []) {
    const root = at.outside ? registration.outside : registration.inside;
    const target = at.outside ?? at.inside;
    if (root === undefined || root === null || target === null) continue;
    if (contains(root, target))
      return { area: "installation", ancestor: false };
    if (contains(target, root)) return { area: "installation", ancestor: true };
  }
  return null;
}
