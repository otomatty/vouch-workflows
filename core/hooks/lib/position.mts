import approvals from "../../registry/approval.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import workflow from "../../registry/workflow.json" with { type: "json" };
import { findApproval } from "./approval.mjs";
import { intentHome, scanAudit } from "./audit.mjs";
import {
  describeTarget,
  missingCheckpoints,
  readCheckpointMode,
  readPlan,
  requiredCheckpoints,
} from "./checkpoints.mjs";

// Read-only observation for resume and display (docs/development/resume.md). It never decides.
export type Position = import("./runtime-contracts.mjs").Position;
export type AuditEvent = import("./contracts.mjs").AuditEvent;

/** @returns The single raw value. */
function frontmatterValue(text: string | null, key: string): string | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text ?? "")?.[1];
  const values = [
    ...(front ?? "").matchAll(new RegExp(`^${key}:[ \\t]*(.*?)\\r?$`, "gm")),
  ].map((match) => match[1] ?? "");
  return values.length === 1 && values[0] ? values[0] : null;
}

/** rules.md language when it is a workflow language, else the default. */
export function readLanguage(rules: string | null): "ja" | "en" {
  const value = frontmatterValue(rules, "language");
  return (
    workflow.languages.includes(value ?? "")
      ? value
      : workflow.defaults.language
  ) as "ja" | "en";
}

function pairQuestions(events: AuditEvent[], intent: string) {
  const mine = events.filter(
    (event) => !event.synthetic && event.intent === intent,
  );
  const byId = new Map(mine.map((event) => [event.id, event]));
  const asks = mine.flatMap((event) =>
    event.type === "question.asked" ? [event] : [],
  );
  const uncertain: string[] = asks
    .filter(
      (ask) =>
        asks.filter((other) => other.question === ask.question).length > 1,
    )
    .map((ask) => ask.id);
  const answered = new Set();
  const defaults: Map<string, import("./contracts.mjs").QuestionDefaulted> =
    new Map();
  for (const event of mine) {
    if (
      event.type !== "question.answered" &&
      event.type !== "question.defaulted"
    )
      continue;
    const parent = byId.get(event.parent);
    if (parent?.type !== "question.asked" || parent.question !== event.question)
      uncertain.push(event.id);
    else if (event.type === "question.answered") answered.add(parent.id);
    else defaults.set(parent.id, event);
  }
  const open = asks.filter((ask) => !answered.has(ask.id));
  return {
    unanswered: open
      .filter((ask) => !defaults.has(ask.id))
      .map((ask) => ({
        question: ask.question,
        event: ask.id,
        ...(ask.default ? { default: ask.default } : {}),
      })),
    defaulted: open.flatMap((ask) => {
      const applied = defaults.get(ask.id);
      return applied
        ? [
            {
              question: ask.question,
              event: ask.id,
              choice: applied.choice,
              defaulted: applied.id,
            },
          ]
        : [];
    }),
    uncertain,
  };
}

/** A read that fails (a link, a non-regular file, bad UTF-8) is an observation, never an abort. */
async function attempt(
  reader: import("./runtime-contracts.mjs").PositionReader,
  path: string,
) {
  try {
    return { text: await reader.readText(path), unreadable: false };
  } catch {
    return { text: null, unreadable: true };
  }
}

export const readPosition: import("./runtime-contracts.mjs").ReadPosition =
  async (reader, intent) => {
    const home = intentHome(intent);
    const path = `${home}/${documents.audit}`;
    const log = await attempt(reader, path);
    const scan = scanAudit(log.text);
    const rules = await attempt(reader, approvals.rules);
    const stages = workflow.stages as import("./contracts.mjs").Stage[];
    const reads = await Promise.all(
      stages.map((stage) =>
        attempt(reader, `${home}/${documents.artifacts[stage]}`),
      ),
    );
    const texts = reads.map((read) => read.text);
    const [text = null, design = null] = texts;
    let checkpoints: import("./runtime-contracts.mjs").CheckpointObservation = {
      state: "unknown",
      reason: `${documents.artifacts.intent} is ${reads[0]?.unreadable ? "unreadable" : "absent"}`,
    };
    if (text !== null) {
      const reading = readPlan(text);
      const mode = rules.unreadable ? null : readCheckpointMode(rules.text);
      if ("error" in reading)
        checkpoints = { state: "unknown", reason: `plan ${reading.error}` };
      else if (!mode)
        checkpoints = {
          state: "unknown",
          reason: `${approvals.rules} ${rules.unreadable ? "is unreadable" : "must set one supported checkpoints mode"}`,
        };
      else {
        const required = requiredCheckpoints(mode, reading.plan);
        const missing = missingCheckpoints({
          required,
          events: scan.events,
          intent,
          texts: { intent: text, design },
          newId: reader.newId,
        });
        checkpoints = {
          state: "observed",
          required: required.map(describeTarget),
          missing: missing.map(describeTarget),
        };
      }
    }
    const status = frontmatterValue(text, "status");
    return {
      intent,
      language: readLanguage(rules.text),
      artifacts: stages.map((stage, index) => ({
        stage,
        path: `${home}/${documents.artifacts[stage]}`,
        present: texts[index] !== null || Boolean(reads[index]?.unreadable),
        status: frontmatterValue(texts[index] ?? null, "status"),
        ...(reads[index]?.unreadable ? { unreadable: true as const } : {}),
      })),
      audit: {
        path,
        events: scan.events.length,
        synthetic: scan.events.filter((event) => event.synthetic).length,
        invalid: scan.invalid,
        duplicates: scan.duplicates,
        ...(log.unreadable ? { unreadable: true as const } : {}),
      },
      checkpoints,
      approval:
        status !== "approved"
          ? "none"
          : findApproval({
                text: text ?? "",
                events: scan.events,
                intent,
                newId: reader.newId,
              })
            ? "evidence"
            : "declared",
      ...pairQuestions(scan.events, intent),
    };
  };
