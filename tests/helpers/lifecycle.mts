import { runLifecycle } from "../../core/hooks/lib/lifecycle.mjs";
import { planned } from "./intent-review.mjs";
import { environment, git, intent, jsonl, project } from "./resume.mjs";

// Shared inputs for the lifecycle command tests. Numbers come from the plan, git or the audit.
export { environment, jsonl, project };
export const home = `vouch/intents/${intent}`;
export const auditPath = `${home}/audit/events.jsonl`;
const later = "2026-09-30T00:00:10.000Z";
export const plan = planned([
  ["U1", "L: wording only", "not-required: no contract"],
  ["U2", "M: api", "required: contract"],
]);
export const review = [
  "| R-12 | note |",
  "<!-- sec:sabotage -->",
  "| 壊した箇所 | 期待 | 結果 | 戻した |",
  "| --- | --- | --- | --- |",
  "| 未記入 | x | y | z |",
  "| Sabotaged location | expected | result | restored |",
  "| parser | unit | caught | restored |",
  "| shortcut | place | open | no |",
  "<!-- sec:limitations -->",
].join("\n");

export const gitOf =
  (replies: Record<string, string | null>) =>
  async (...args: string[]) =>
    replies[args.join(" ")] ?? null;

export function command(
  files: ReturnType<typeof project>,
  args: string[],
  shape: {
    intent?: string | null;
    now?: string;
    harness?: import("../../core/hooks/lib/contracts.mjs").Harness | null;
    git?: (...args: string[]) => Promise<string | null>;
    environment?: typeof environment;
    clock?: boolean;
  } = {},
) {
  return runLifecycle(files, shape.environment ?? environment, git, {
    intent: shape.intent === undefined ? intent : shape.intent,
    args,
    ...(shape.clock === false ? {} : { now: () => shape.now ?? later }),
    ...("harness" in shape ? { harness: shape.harness } : {}),
    ...(shape.git ? { git: shape.git } : {}),
  });
}

export const rows = (
  files: ReturnType<typeof project>,
  path: string = auditPath,
) =>
  (files.data.get(path) ?? "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

export const ids = (
  report: import("../../core/hooks/lib/runtime-contracts.mjs").DoctorReport,
) => report.checks.map((item) => item.id);

export function event(id: string, fields: Record<string, unknown>) {
  return {
    id,
    v: 1,
    ts: "2026-09-30T00:00:00.000Z",
    actor: "hook",
    intent,
    ...fields,
  };
}
