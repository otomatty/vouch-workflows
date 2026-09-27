import { performance } from "node:perf_hooks";
import { test } from "node:test";
import budgets from "../../core/registry/budgets.json" with { type: "json" };

/**
 * Node 22 applies the CLI timeout to an isolated test file as well as its cases.
 * Keep the five-second case limit explicit, including synchronous child calls.
 * @param {string} name
 * @param {(t:import('node:test').TestContext)=>void|Promise<void>} fn
 */
export function hookTest(name, fn) {
  return test(name, { timeout: budgets.timing.testTimeoutMs }, async (t) => {
    const started = performance.now();
    await fn(t);
    const elapsed = performance.now() - started;
    if (elapsed > budgets.timing.testTimeoutMs)
      throw new Error(`TEST-12: ${name} took ${elapsed.toFixed(1)} ms`);
  });
}
