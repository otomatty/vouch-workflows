// Test-only observation and controlled preflight race; never installed.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
const root = resolve(process.env.VOUCH_TEST_ROOT ?? "");
const owned = relative(tmpdir(), root);
if (!owned.startsWith("vouch-runtime-") || owned.includes("..") || isAbsolute(owned))
  throw new Error("TEST-4: probe needs its owned sandbox");
const destination = resolve(root, "dist/claude");
const backup = resolve(root, "swapped-claude");
const outside = resolve(root, "outside");
for (const target of [destination, backup, outside]) {
  const local = relative(root, target);
  if (isAbsolute(local) || local.startsWith("..")) throw new Error("TEST-4");
}
const original = { ...fs };
const hits = new Map();
let swapped = false;
fs.lstatSync = (...args) => {
  const path = String(args[0]);
  hits.set(path, (hits.get(path) ?? 0) + 1);
  return original.lstatSync(...args);
};
fs.readdirSync = (...args) => {
  const entries = original.readdirSync(...args);
  if (process.env.VOUCH_TEST_SWAP === "1" && !swapped && resolve(String(args[0])) === destination) {
    swapped = true;
    original.renameSync(destination, backup);
    original.symlinkSync(outside, destination, "junction");
  }
  return entries;
};
syncBuiltinESMExports();
process.on("exit", () => original.writeFileSync(resolve(root, "probe.json"), JSON.stringify({ hits: [...hits], swapped })));
