import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import budgets from "../../core/registry/budgets.json" with { type: "json" };
import { runHook, sessionFor } from "./runtime.mjs";

// One HOOK-13 load process: starts no-op hooks until the stop file appears, the root is gone
// or twice the per-case limit has passed, so an interrupted test cannot leave it running.
const [root = "", stop = ""] = process.argv.slice(2);
const fixture = sessionFor(root);
const deadline = performance.now() + budgets.timing.testTimeoutMs * 2;
for (
  let started = 0;
  existsSync(root) && !existsSync(stop) && performance.now() < deadline;
  started++
) {
  runHook("vouch-record-session-start", fixture, {
    root,
    intent: "",
    coverage: false,
  });
  if (started === 0) process.stdout.write("ready\n");
}
