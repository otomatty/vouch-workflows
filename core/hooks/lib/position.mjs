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
/** @typedef {import('./runtime-contracts.mjs').Position} Position
 * @typedef {import('./contracts.mjs').AuditEvent} AuditEvent */

/** @param {string|null} text @param {string} key @returns {string|null} The single raw value. */
function frontmatterValue(text, key) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text ?? "")?.[1];
  const values = [
    ...(front ?? "").matchAll(new RegExp(`^${key}:[ \\t]*(.*?)\\r?$`, "gm")),
  ].map((match) => match[1] ?? "");
  return values.length === 1 && values[0] ? values[0] : null;
}

/** rules.md language when it is a workflow language, else the default. @param {string|null} rules
 * @returns {'ja'|'en'} */
export function readLanguage(rules) {
  const value = frontmatterValue(rules, "language");
  return /** @type {'ja'|'en'} */ (
    workflow.languages.includes(value ?? "")
      ? value
      : workflow.defaults.language
  );
}

/** @param {AuditEvent[]} events @param {string} intent */
function pairQuestions(events, intent) {
  const mine = events.filter(
    (event) => !event.synthetic && event.intent === intent,
  );
  const byId = new Map(mine.map((event) => [event.id, event]));
  const asks = mine.flatMap((event) =>
    event.type === "question.asked" ? [event] : [],
  );
  /** @type {string[]} */ const uncertain = asks
    .filter(
      (ask) =>
        asks.filter((other) => other.question === ask.question).length > 1,
    )
    .map((ask) => ask.id);
  const answered = new Set();
  /** @type {Map<string,import('./contracts.mjs').QuestionDefaulted>} */ const defaults =
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

/** @type {import('./runtime-contracts.mjs').ReadPosition} */
export async function readPosition(reader, intent) {
  const home = intentHome(intent);
  const path = `${home}/${documents.audit}`;
  const scan = scanAudit(await reader.readText(path));
  const rules = await reader.readText(approvals.rules);
  const stages = /** @type {import('./contracts.mjs').Stage[]} */ (
    workflow.stages
  );
  const texts = await Promise.all(
    stages.map((stage) =>
      reader.readText(`${home}/${documents.artifacts[stage]}`),
    ),
  );
  const [text = null, design = null] = texts;
  /** @type {import('./runtime-contracts.mjs').CheckpointObservation} */
  let checkpoints = {
    state: "unknown",
    reason: `${documents.artifacts.intent} is absent`,
  };
  if (text !== null) {
    const reading = readPlan(text);
    const mode = readCheckpointMode(rules);
    if ("error" in reading)
      checkpoints = { state: "unknown", reason: `plan ${reading.error}` };
    else if (!mode)
      checkpoints = {
        state: "unknown",
        reason: `${approvals.rules} must set one supported checkpoints mode`,
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
    language: readLanguage(rules),
    artifacts: stages.map((stage, index) => ({
      stage,
      path: `${home}/${documents.artifacts[stage]}`,
      present: texts[index] !== null,
      status: frontmatterValue(texts[index] ?? null, "status"),
    })),
    audit: {
      path,
      events: scan.events.length,
      synthetic: scan.events.filter((event) => event.synthetic).length,
      invalid: scan.invalid,
      duplicates: scan.duplicates,
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
}
