import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
let failed = false;
/** @param {string} name @param {boolean} ok @param {string} detail */
function report(name, ok, detail) {
  console.log(`${ok ? "OK" : "FAIL"} ${name}: ${detail}`);
  if (!ok) failed = true;
}
report("Node.js", major > 22 || (major === 22 && minor >= 19), process.version);
const git = spawnSync("git", ["--version"], {
  encoding: "utf8",
  windowsHide: true,
});
report(
  "Git",
  git.status === 0,
  git.stdout?.trim() || git.error?.message || "not found",
);
report("lockfile", existsSync("package-lock.json"), "package-lock.json");
for (const [name, version] of Object.entries(pkg.devDependencies)) {
  try {
    const installed = JSON.parse(
      readFileSync(
        new URL(`../node_modules/${name}/package.json`, import.meta.url),
        "utf8",
      ),
    ).version;
    report(name, installed === version, `${installed} (expected ${version})`);
  } catch {
    report(name, false, "Run npm ci.");
  }
}
process.exitCode = failed ? 1 : 0;
