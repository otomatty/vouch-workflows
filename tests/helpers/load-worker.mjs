import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import budgets from "../../core/registry/budgets.json" with { type: "json" };
import { executeHook } from "./hook-process.mjs";

// One HOOK-13 load process: starts no-op hooks until the stop file appears, the root is gone
// or twice the per-case limit has passed, so an interrupted test cannot leave it running.
const [root = "", stop = "", prepared = ""] = process.argv.slice(2);
// The parent validates captured provenance and schema before passing this packet.
const { harness, payload } = JSON.parse(prepared);
const deadline = performance.now() + budgets.timing.testTimeoutMs * 2;
for (
  let started = 0;
  existsSync(root) && !existsSync(stop) && performance.now() < deadline;
  started++
) {
  executeHook("vouch-record-session-start", payload, harness, {
    root,
    intent: "",
    coverage: false,
  });
  if (started === 0) process.stdout.write("ready\n");
}
