import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createAuditStore } from "../core/hooks/lib/audit.mjs";
import { isAuditEvent } from "../core/hooks/lib/validation.mjs";
import budgets from "../core/registry/budgets.json" with { type: "json" };

// Developer-only synthetic workload. This does not measure the HOOK-13 process budget.
const sample = JSON.parse(
  readFileSync(
    new URL("../tests/fixtures/audit/session.started.jsonl", import.meta.url),
    "utf8",
  ),
);
if (!isAuditEvent(sample) || sample.synthetic !== true)
  throw new Error("Benchmark requires an explicitly synthetic audit fixture");
const workloads = [];
for (const count of [0, 2000]) {
  const original = Array.from(
    { length: count },
    (_, i) => `${JSON.stringify({ ...sample, id: `benchmark-${i}` })}\n`,
  ).join("");
  const next = { ...sample, id: "benchmark-next" };
  const times = [];
  for (let i = 0; i < budgets.timing.samples; i++) {
    let content = original;
    /** @type {import('../core/hooks/lib/runtime-contracts.mjs').FileStore} */
    const files = {
      resolvePath: async (path) => path,
      readText: async () => content,
      writeText: async () => {
        throw new Error("unexpected writeText");
      },
      locate: async () => {
        throw new Error("unexpected locate");
      },
      readBytes: async () => {
        throw new Error("unexpected readBytes");
      },
      createBytes: async () => {
        throw new Error("unexpected createBytes");
      },
      list: async () => {
        throw new Error("unexpected list");
      },
      updateText: async (_path, update) => {
        const after = update(content);
        if (after === null || after === content) return false;
        content = after;
        return true;
      },
    };
    const audit = createAuditStore(files, "audit");
    const start = performance.now();
    const found = await audit.find(next.id);
    const result = await audit.append([next]);
    times.push(performance.now() - start);
    if (
      found !== undefined ||
      result !== "appended" ||
      content !== `${original}${JSON.stringify(next)}\n`
    )
      throw new Error("Benchmark did not perform the expected complete append");
  }
  times.sort((a, b) => a - b);
  workloads.push({
    records: count,
    samples: times.length,
    p50_ms: times[Math.ceil(times.length * 0.5) - 1],
    p95_ms: times[Math.ceil(times.length * 0.95) - 1],
  });
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      synthetic: true,
      scope:
        "in-memory audit lookup and append; excludes process startup and disk",
      workloads,
    },
    null,
    2,
  ),
);
