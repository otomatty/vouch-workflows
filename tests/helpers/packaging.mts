import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function packageRun(args: string[]) {
  return spawnSync(process.execPath, ["scripts/package.mjs", ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 4000,
  });
}

/** Distributed files of a source directory: the compiled .mjs, never the .mts sources. */
export const distributedTree = (root: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(tree(root)).filter(([path]) => !path.endsWith(".mts")),
  );

export function tree(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = resolve(entry.parentPath, entry.name);
        return [
          path.slice(resolve(root).length + 1).replaceAll("\\", "/"),
          readFileSync(path).toString("base64"),
        ];
      })
      .sort(([a], [b]) => (a ?? "").localeCompare(b ?? "")),
  );
}
