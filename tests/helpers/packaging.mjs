import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** @param {string[]} args */
export function packageRun(args) {
  return spawnSync(process.execPath, ["scripts/package.mjs", ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 4000,
  });
}

/** @param {string} root @returns {Record<string,string>} */
export function tree(root) {
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
