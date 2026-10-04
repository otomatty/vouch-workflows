import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import { elapsedMilliseconds } from "./clock.mjs";
import { harnessFields, last, live } from "./lifecycle-shared.mjs";

// Gate, review, learn and session-end records. The caller never supplies a number.
export type Life = import("./lifecycle-shared.mjs").Life;
export type Outcome = import("./lifecycle-shared.mjs").Outcome;
export type GitReader = import("./lifecycle-shared.mjs").GitReader;

const word = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const headers = new Set([
  "壊した箇所",
  "その場しのぎの候補",
  "Sabotaged location",
  "Shortcut candidate",
  "未記入",
  "Unfilled",
]);

const rejected = (id: string, detail: string): Outcome => ({
  rejected: { v: 1, ok: false, checks: [{ id, ok: false, detail }] },
});

function reviewCounts(text: string) {
  const findings = text
    .split("\n")
    .filter((line) => /^\| R-[1-9]\d{0,5} \|/.test(line)).length;
  const section =
    text.split("<!-- sec:sabotage -->")[1]?.split("<!-- ")[0] ?? "";
  const rows = section.split("\n").flatMap((line) => {
    if (!line.startsWith("|") || /^\|\s*---/.test(line)) return [];
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const first = cells[0] ?? "";
    return first && !headers.has(first) ? [cells] : [];
  });
  return {
    findings,
    sabotage: {
      tried: rows.length,
      caught: rows.filter((cells) => cells[2] === "caught").length,
    },
  };
}

async function rulesAdded(git: GitReader) {
  const tracked = await git("ls-files", "--", "vouch/rules.md");
  if (!tracked?.trim()) return null;
  const diff = await git("diff", "-U0", "HEAD", "--", "vouch/rules.md");
  if (diff === null) return null;
  return diff
    .split("\n")
    .filter((line) => line.startsWith("+| ") && !line.startsWith("+++")).length;
}

export function gateRecord(
  life: Life,
  operation: "gate-approved" | "gate-rejected",
): Outcome {
  const reason = life.rest[0] ?? "";
  const gate = last(
    life.events,
    (item) =>
      item.type === "gate.opened" && item.intent === life.intent && live(item),
  );
  if (
    (operation === "gate-approved" && life.rest.length) ||
    (operation === "gate-rejected" &&
      (life.rest.length !== 1 || !word.test(reason)))
  )
    return rejected(
      "LIFECYCLE-ARGS",
      operation === "gate-approved"
        ? "gate-approved takes no arguments"
        : "gate-rejected needs one reason token",
    );
  if (gate?.type !== "gate.opened")
    return rejected("LIFECYCLE-EVIDENCE", "a live gate.opened is required");
  const id = life.idFor([gate.id]);
  const ts = life.at(id);
  const wait = elapsedMilliseconds(gate.ts, ts);
  if (wait === null)
    return rejected(
      "LIFECYCLE-EVIDENCE",
      "ordered UTC timestamps are required",
    );
  const common = {
    id,
    v: 1 as const,
    ts,
    actor: "human" as const,
    intent: life.intent,
    source: gate.source,
    parent: gate.id,
    wait_ms: wait,
    ...harnessFields(life.harness),
  };
  return operation === "gate-approved"
    ? { event: { ...common, type: "gate.approved" } }
    : { event: { ...common, type: "gate.rejected", reason } };
}

export async function reviewRecord(
  life: Life,
  operation: "review-requested" | "review-completed",
): Promise<Outcome> {
  const iteration = Number(life.rest[0]);
  if (life.rest.length !== 1 || !/^[1-9]\d{0,3}$/.test(life.rest[0] ?? ""))
    return rejected(
      "LIFECYCLE-ARGS",
      "an iteration from 1 to 9999 is required",
    );
  if (!life.harness)
    return rejected(
      "LIFECYCLE-HARNESS",
      "the command must be the installed .claude or .codex entry",
    );
  const id = life.idFor([String(iteration), life.harness]);
  const ts = life.at(id);
  if (operation === "review-requested")
    return {
      event: {
        id,
        v: 1,
        type: "review.requested",
        ts,
        actor: "model",
        intent: life.intent,
        iteration,
        harness: life.harness,
      },
    };
  const opening = last(
    life.events,
    (item) =>
      item.type === "review.requested" &&
      item.intent === life.intent &&
      item.iteration === iteration &&
      item.harness === life.harness &&
      live(item),
  );
  const text = await life.files.readText(
    `${life.home}/${documents.artifacts.verify}`,
  );
  const duration = opening ? elapsedMilliseconds(opening.ts, ts) : null;
  if (!opening || duration === null || text === null)
    return rejected(
      "LIFECYCLE-UNMEASURED",
      "a live review.requested and review.md are required",
    );
  return {
    event: {
      id,
      v: 1,
      type: "review.completed",
      ts,
      actor: "reviewer",
      intent: life.intent,
      iteration,
      harness: life.harness,
      ...reviewCounts(text),
      parent: opening.id,
      duration_ms: duration,
    },
  };
}

export async function learnRecorded(life: Life): Promise<Outcome> {
  const added = life.rest.length ? null : await rulesAdded(life.git);
  if (life.rest.length || added === null)
    return rejected(
      life.rest.length ? "LIFECYCLE-ARGS" : "LIFECYCLE-UNMEASURED",
      life.rest.length
        ? "learn-recorded takes no arguments"
        : "tracked vouch/rules.md and its diff against HEAD are required",
    );
  const id = life.idFor([]);
  return {
    event: {
      id,
      v: 1,
      type: "learn.recorded",
      ts: life.at(id),
      actor: "hook",
      intent: life.intent,
      rules_added: added,
      ...harnessFields(life.harness),
    },
  };
}

export function sessionEnded(life: Life): Outcome {
  const session = life.rest[0] ?? "";
  const parent = last(
    life.events,
    (item) =>
      (item.type === "session.started" || item.type === "session.resumed") &&
      item.intent === life.intent &&
      item.session === session &&
      live(item),
  );
  if (life.rest.length !== 1 || !word.test(session))
    return rejected("LIFECYCLE-ARGS", "one session id token is required");
  if (!parent)
    return rejected(
      "LIFECYCLE-EVIDENCE",
      "a live session.started or session.resumed for that session is required",
    );
  const id = life.idFor([session]);
  const ts = life.at(id);
  const duration = elapsedMilliseconds(parent.ts, ts);
  if (duration === null)
    return rejected(
      "LIFECYCLE-EVIDENCE",
      "ordered UTC timestamps are required",
    );
  return {
    event: {
      id,
      v: 1,
      type: "session.ended",
      ts,
      actor: "hook",
      intent: life.intent,
      session,
      parent: parent.id,
      duration_ms: duration,
      ...harnessFields(life.harness),
    },
  };
}
