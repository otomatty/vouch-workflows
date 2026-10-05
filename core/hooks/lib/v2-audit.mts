import candidates from "../../registry/audit-migration.json" with {
  type: "json",
};
import migration from "../../registry/migration.json" with { type: "json" };
import { migratedOrigin } from "./audit.mjs";
import { elapsedMilliseconds, newId } from "./clock.mjs";

// v2 audit shards → Vouch audit records (docs/development/migrate.md). Only three v2 events have
// every required value restorable; everything else keeps its original text as legacy.<NAME>.
export type AuditBlock = import("./migration-contracts.mjs").AuditBlock;
export type AuditEvent = import("./contracts.mjs").AuditEvent;
export type Stage = import("./contracts.mjs").Stage;
export type Placed = {
  block: AuditBlock;
  ts: string;
  estimated: boolean;
  stage: Stage | null;
};

const stages = migration.stages as Record<string, Stage | null>;
const names = candidates as Record<string, string>;
const eventName = /^[A-Z][A-Z0-9_]*$/;

const valid = (value: string | undefined) =>
  value !== undefined && elapsedMilliseconds(value, value) === 0;

export const readShard: import("./migration-contracts.mjs").ReadShard = (
  path,
  text,
) => {
  const blocks: AuditBlock[] = [];
  let lines: { start: number; content: string; line: number }[] = [];
  const flush = () => {
    let kept = lines;
    while (
      kept[0] &&
      (!kept[0].content.trim() ||
        (!blocks.length && /^# /.test(kept[0].content)))
    )
      kept = kept.slice(1);
    while (kept.length && !kept.at(-1)?.content.trim())
      kept = kept.slice(0, -1);
    lines = [];
    const first = kept[0];
    const last = kept.at(-1);
    if (!first || !last) return;
    const fields: Record<string, string> = {};
    for (const { content } of kept) {
      const field = /^\*\*([^*]+)\*\*:[ \t]*(.*?)[ \t]*$/.exec(content);
      if (field?.[1] && !Object.hasOwn(fields, field[1]))
        fields[field[1]] = field[2] ?? "";
    }
    blocks.push({
      path,
      index: blocks.length + 1,
      line: first.line,
      raw: text.slice(first.start, last.start + last.content.length),
      ts: valid(fields.Timestamp) ? (fields.Timestamp ?? null) : null,
      name: eventName.test(fields.Event ?? "") ? (fields.Event ?? null) : null,
      fields,
    });
  };
  let start = 0;
  text.split("\n").forEach((piece, index) => {
    const content = piece.endsWith("\r") ? piece.slice(0, -1) : piece;
    if (/^---[ \t]*$/.test(content)) flush();
    else lines.push({ start, content, line: index + 1 });
    start += piece.length + 1;
  });
  flush();
  return blocks;
};

function chronological(a: string, b: string): number {
  const forward = elapsedMilliseconds(a, b);
  if (forward) return -1;
  return elapsedMilliseconds(b, a) ? 1 : 0;
}

/** Times per shard: a block without its own takes the previous one, else the next. */
function place(blocks: AuditBlock[]) {
  const shards: Map<string, AuditBlock[]> = new Map();
  for (const block of blocks)
    shards.set(block.path, [...(shards.get(block.path) ?? []), block]);
  const placed: Placed[] = [];
  const problems: string[] = [];
  for (const [path, list] of shards) {
    let previous: string | null = null;
    list.forEach((block, index) => {
      const ts =
        block.ts ??
        previous ??
        list.slice(index + 1).find((item) => item.ts)?.ts ??
        null;
      if (ts === null) return;
      previous = ts;
      const relevant =
        block.name === "STAGE_STARTED" || block.name === "STAGE_COMPLETED";
      placed.push({
        block,
        ts,
        estimated: block.ts === null,
        stage: relevant ? (stages[block.fields.Stage ?? ""] ?? null) : null,
      });
    });
    if (!list.some((block) => block.ts))
      problems.push(`${path}: no valid timestamp`);
  }
  placed.sort(
    (a, b) =>
      chronological(a.ts, b.ts) ||
      (a.block.path < b.block.path
        ? -1
        : a.block.path > b.block.path
          ? 1
          : 0) ||
      a.block.index - b.block.index,
  );
  return { placed, problems };
}

export const convertAudit: import("./migration-contracts.mjs").ConvertAudit = (
  blocks,
  intent,
  progress,
) => {
  const { placed, problems } = place(blocks);
  const closing: Partial<Record<Stage, Placed>> = {};
  for (const item of placed)
    if (item.block.name === "STAGE_COMPLETED" && item.stage)
      closing[item.stage] = item;
  const started: Partial<Record<Stage, AuditEvent>> = {};
  const events: AuditEvent[] = [];
  for (const item of placed) {
    const { block, stage } = item;
    const name = block.name ?? migration.audit.untyped;
    const base = {
      id: newId(
        intent,
        JSON.stringify(["migration", block.path, block.index, block.raw]),
      ),
      v: 1 as const,
      ts: item.ts,
      actor: "hook" as const,
      intent,
    };
    const origin = {
      original_type: name,
      raw: block.raw,
      source_path: `${block.path}#L${block.line}`,
      ...(item.estimated ? { estimated: true as const } : {}),
    };
    const opening = stage ? started[stage] : undefined;
    const duration = opening ? elapsedMilliseconds(opening.ts, item.ts) : null;
    let event: AuditEvent;
    if (name === "STAGE_STARTED" && stage && !opening) {
      event = { ...base, type: "stage.started", stage, ...origin };
      started[stage] = event;
    } else if (
      name === "STAGE_COMPLETED" &&
      stage &&
      // Build needs loop_iterations and tests, which v2 never recorded.
      stage !== "build" &&
      progress[stage].state === "completed" &&
      closing[stage] === item &&
      opening &&
      duration !== null
    )
      event = {
        ...base,
        type: "stage.completed",
        stage,
        parent: opening.id,
        duration_ms: duration,
        ...origin,
        estimated: true,
      };
    else if (name === "RULE_LEARNED")
      event = { ...base, type: "learn.recorded", rules_added: 1, ...origin };
    else event = { ...base, type: `legacy.${name}`, ...origin };
    events.push(event);
  }
  return {
    events,
    types: summarize(events),
    decisions: events.flatMap((event) => {
      const origin = migratedOrigin(event);
      return origin.original_type &&
        migration.audit.decisions.includes(origin.original_type)
        ? [
            {
              id: event.id,
              name: origin.original_type,
              ts: event.ts,
              source_path: `${origin.source_path}`,
            },
          ]
        : [];
    }),
    problems,
  };
};

function summarize(
  events: AuditEvent[],
): import("./migration-contracts.mjs").ConvertedAudit["types"] {
  const types: Map<
    string,
    import("./migration-contracts.mjs").ConvertedAudit["types"][number]
  > = new Map();
  for (const event of events) {
    const origin = migratedOrigin(event);
    const name = `${origin.original_type}`;
    const entry = types.get(name) ?? {
      name,
      count: 0,
      to: names[name] ?? "legacy",
      converted: 0,
      legacy: 0,
      estimated: 0,
    };
    entry.count++;
    if (event.type.startsWith("legacy.")) entry.legacy++;
    else entry.converted++;
    if (origin.estimated) entry.estimated++;
    types.set(name, entry);
  }
  return [...types.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}
