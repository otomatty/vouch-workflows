import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import runtime from "../../registry/runtime.json" with { type: "json" };
import guard from "../../registry/write-guard.json" with { type: "json" };
import {
  matches,
  nativeRegistrationNames,
  normalizeSegment,
} from "./areas.mjs";
import { createFileStore } from "./fs.mjs";

/** @param {import('./contracts.mjs').ReadyHookContext} ctx @param {string} entry
 * @returns {Promise<import('./runtime-contracts.mjs').GuardScope>} */
export async function guardScope(ctx, entry) {
  const hook = entry.startsWith("file:") ? fileURLToPath(entry) : entry;
  const runtimeRoot = dirname(dirname(hook));
  const location = await ctx.locate(runtimeRoot);
  const outside = location.outside;
  /** @type {Promise<string[]>|undefined} */
  let runtimeFiles;
  const managed = /(?:^|[/\\])\.vouch[/\\]versions[/\\]/.test(hook)
    ? {
        managed: `.${ctx.harness}`,
        runtime: resolve(dirname(hook)),
        ...(outside
          ? {
              externalRuntime: outside,
              runtimeFiles: () => (runtimeFiles ??= runtimePaths(outside)),
            }
          : {}),
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

/** Match a shell pattern only against a known canonical protected location.
 * @param {string} root @param {string} target
 * @returns {import('./runtime-contracts.mjs').GuardMatch|null} */
function knownMatch(root, target) {
  if (contains(root, target)) return { area: "installation", ancestor: false };
  if (contains(target, root)) return { area: "installation", ancestor: true };
  if (!/[*?[]/.test(target)) return null;
  /** @param {string} value */
  const segments = (value) =>
    value
      .replaceAll("\\", "/")
      .split("/")
      .filter(Boolean)
      .map(normalizeSegment);
  const parts = segments(target);
  const names = segments(root);
  const star = parts.indexOf("**");
  if (star >= 0) {
    let positions = new Set([0]);
    for (const part of parts) {
      const next = new Set();
      if (part === "**")
        for (let i = Math.min(...positions); i <= names.length; i++)
          next.add(i);
      else
        for (const i of positions)
          if (
            i < names.length &&
            matches(part, /** @type {string} */ (names[i]))
          )
            next.add(i + 1);
      positions = next;
      if (positions.size === 0) return null;
    }
    return { area: "installation", ancestor: !positions.has(names.length) };
  }
  for (let i = 0; i < Math.min(parts.length, names.length); i++)
    if (
      !matches(
        /** @type {string} */ (parts[i]),
        /** @type {string} */ (names[i]),
      )
    )
      return null;
  return {
    area: "installation",
    ancestor: parts.length < names.length,
  };
}

/** Canonical managed paths retain protection through aliases and junctions.
 * @param {import('./runtime-contracts.mjs').PathLocation} at
 * @param {import('./runtime-contracts.mjs').GuardScope} scope
 * @returns {Promise<import('./runtime-contracts.mjs').GuardMatch|null>} */
export async function externalRuntimeMatch(at, scope) {
  if (at.outside && scope.externalRuntime) {
    const match = knownMatch(scope.externalRuntime, at.outside);
    if (match) return match;
    if (at.outside.includes("**"))
      for (const path of (await scope.runtimeFiles?.()) ?? []) {
        const found = knownMatch(path, at.outside);
        if (found) return found;
      }
  }
  for (const registration of scope.nativeRegistrations ?? []) {
    const root = at.outside ? registration.outside : registration.inside;
    const target = at.outside ?? at.inside;
    if (root === undefined || root === null || target === null) continue;
    const match = knownMatch(root, target);
    if (match) return match;
  }
  return null;
}

/** Enumerate only the selected runtime for a recursive glob; never follow links.
 * @param {string} root @returns {Promise<string[]>} */
async function runtimePaths(root) {
  const paths = runtime.files.map((path) => resolve(root, path));
  paths.push(resolve(root, "AGENTS.md"));
  try {
    const files = await createFileStore(root);
    /** @param {string} relative */
    async function collect(relative) {
      for (const entry of (await files.list(relative || ".")) ?? []) {
        const part = relative ? `${relative}/${entry.name}` : entry.name;
        paths.push(resolve(root, part));
        if (entry.kind === "directory") await collect(part);
      }
    }
    await collect("");
  } catch {
    // Keep known mandatory paths protected when directory metadata is unavailable.
  }
  return paths;
}
