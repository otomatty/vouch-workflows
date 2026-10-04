import { readFileSync } from "node:fs";
import { join } from "node:path";

/** V8 samples include blocking/idle time; these are not process CPU usage counters.
 * @param {{functionName:string,url:string}} frame */
function category({ functionName: name, url }) {
  if (url.includes("/core/hooks/lib/validation.mjs")) return "hook validation";
  if (url.includes("/core/hooks/")) return "hook code";
  if (url.startsWith("node:internal/modules/")) return "module loader";
  if (url.startsWith("node:internal/bootstrap/")) return "builtin compile";
  if (url === "node:fs" || url.startsWith("node:internal/fs/"))
    return `file I/O ${name}`;
  if (url.startsWith("node:")) return "node other";
  if (!url) return name.startsWith("(") ? name : `native ${name}`;
  return "other";
}

/** @param {Record<string,number>} totals */
const ranked = (totals) =>
  Object.entries(totals)
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms);

/** Keep each cold/slow process, matched by an explicit profile filename.
 * @param {string} directory @param {{index:number,ms:number}[]} samples */
export function profileSummary(directory, samples) {
  const runs = samples.map(({ index, ms }) => {
    /** @type {{startTime:number,endTime:number,nodes:{id:number,callFrame:{functionName:string,url:string}}[],samples:number[],timeDeltas:number[]}} */
    const profile = JSON.parse(
      readFileSync(join(directory, `sample-${index}.cpuprofile`), "utf8"),
    );
    const frames = new Map(
      profile.nodes.map((node) => [node.id, node.callFrame]),
    );
    /** @type {Record<string,number>} */ const totals = {};
    profile.samples.forEach((id, offset) => {
      const frame = frames.get(id);
      const name = frame ? category(frame) : "unknown";
      totals[name] =
        (totals[name] ?? 0) + (profile.timeDeltas[offset] ?? 0) / 1000;
    });
    const window = (profile.endTime - profile.startTime) / 1000;
    return {
      index,
      wall_ms: ms,
      profile_window_ms: window,
      outside_profile_ms: ms - window,
      categories: ranked(totals),
    };
  });
  /** @type {Record<string,number>} */ const totals = {};
  for (const run of runs)
    for (const { name, ms } of run.categories)
      totals[name] = (totals[name] ?? 0) + ms / runs.length;
  return {
    executions: runs.length,
    sampled_ms: Object.values(totals).reduce((sum, ms) => sum + ms, 0),
    categories: ranked(totals),
    runs,
  };
}
