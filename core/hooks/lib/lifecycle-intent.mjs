import workflow from "../../registry/workflow.json" with { type: "json" };
import { elapsedMilliseconds } from "./clock.mjs";
import { harnessFields, last, live } from "./lifecycle-shared.mjs";
import { sharedWaitIds } from "./measure.mjs";

// Intent, stage and unit records. Numbers come from the plan, the audit or git.
/** @typedef {import('./lifecycle-shared.mjs').Life} Life
 * @typedef {import('./lifecycle-shared.mjs').Outcome} Outcome
 * @typedef {import('./contracts.mjs').AuditEvent} AuditEvent
 * @typedef {import('./lifecycle-shared.mjs').GitReader} GitReader */

/** @param {string} id @param {string} detail @returns {Outcome} */
const rejected = (id, detail) => ({
  rejected: { v: 1, ok: false, checks: [{ id, ok: false, detail }] },
});

/** @param {GitReader} git */
async function numstat(git) {
  const diff = await git("diff", "--numstat", "HEAD");
  if (diff === null) return null;
  let files = 0;
  let lines = 0;
  for (const line of diff.split("\n")) {
    if (!line) continue;
    const [added, deleted] = line.split("\t");
    if (
      added === "-" ||
      deleted === "-" ||
      !/^\d+$/.test(added ?? "") ||
      !/^\d+$/.test(deleted ?? "")
    )
      return null;
    files += 1;
    lines += Number(added) + Number(deleted);
  }
  return { files_changed: files, lines_changed: lines };
}

/** @param {AuditEvent[]} events @param {string} intent */
function breakdown(events, intent) {
  const shared = new Set(sharedWaitIds(events));
  const waits = events.filter(
    (item) =>
      live(item) &&
      item.intent === intent &&
      (item.type === "question.answered" || item.type === "question.defaulted"),
  );
  const reviews = events.filter(
    (item) =>
      live(item) &&
      item.intent === intent &&
      (item.type === "intent.approved" ||
        ((item.type === "gate.approved" || item.type === "gate.rejected") &&
          !shared.has(item.id))),
  );
  /** Missing wait_ms is unobtainable; an empty selection is a real zero. */
  const sum = (/** @type {AuditEvent[]} */ rows) => {
    let total = 0;
    for (const item of rows) {
      if (typeof item.wait_ms !== "number") return null;
      total += item.wait_ms;
    }
    return total;
  };
  return { waits: sum(waits), reviews: sum(reviews) };
}

/** @param {Life} life @returns {Outcome} */
export function intentCreated(life) {
  const { rest, reading, intent, harness } = life;
  if (rest.length)
    return rejected("LIFECYCLE-ARGS", "intent-created takes no arguments");
  if ("error" in reading) return rejected("LIFECYCLE-PLAN", reading.error);
  const id = life.idFor([]);
  return {
    event: {
      id,
      v: 1,
      type: "intent.created",
      ts: life.at(id),
      actor: "model",
      intent,
      risk: reading.plan.risk,
      ...harnessFields(harness),
    },
  };
}

/** @param {Life} life @returns {Outcome} */
export function intentCompleted(life) {
  const { rest, events, intent, harness } = life;
  if (rest.length)
    return rejected("LIFECYCLE-ARGS", "intent-completed takes no arguments");
  const created = last(
    events,
    (item) =>
      item.type === "intent.created" && item.intent === intent && live(item),
  );
  const id = life.idFor([]);
  const ts = life.at(id);
  const duration = created ? elapsedMilliseconds(created.ts, ts) : null;
  const { waits, reviews } = breakdown(events, intent);
  if (
    !created ||
    duration === null ||
    waits === null ||
    reviews === null ||
    duration - waits - reviews < 0
  )
    return rejected(
      "LIFECYCLE-UNMEASURED",
      "intent.created and a non-negative breakdown are required",
    );
  return {
    event: {
      id,
      v: 1,
      type: "intent.completed",
      ts,
      actor: "hook",
      intent,
      parent: created.id,
      duration_ms: duration,
      ai_work_ms: duration - waits - reviews,
      human_wait_ms: waits,
      human_review_ms: reviews,
      ...harnessFields(harness),
    },
  };
}

/** @param {Life} life @param {'stage-started' | 'stage-completed'} operation @returns {Outcome} */
export function stageRecord(life, operation) {
  const stage = life.rest[0];
  const known = workflow.stages.includes(
    /** @type {import('./contracts.mjs').Stage} */ (stage),
  );
  if (life.rest.length !== 1 || !known)
    return rejected("LIFECYCLE-ARGS", "a workflow stage is required");
  if (operation === "stage-completed" && stage === "build")
    return rejected(
      "LIFECYCLE-UNMEASURED",
      "build loop_iterations and tests are not recorded by a hook",
    );
  const id = life.idFor([/** @type {string} */ (stage)]);
  const ts = life.at(id);
  const common = {
    id,
    v: /** @type {const} */ (1),
    ts,
    actor: /** @type {const} */ ("hook"),
    intent: life.intent,
    ...harnessFields(life.harness),
  };
  if (operation === "stage-started")
    return {
      event: {
        ...common,
        type: "stage.started",
        stage: /** @type {import('./contracts.mjs').Stage} */ (stage),
      },
    };
  const opening = last(
    life.events,
    (item) =>
      item.type === "stage.started" &&
      item.intent === life.intent &&
      item.stage === stage &&
      live(item),
  );
  const duration = opening ? elapsedMilliseconds(opening.ts, ts) : null;
  if (!opening || duration === null)
    return rejected(
      "LIFECYCLE-UNMEASURED",
      "a live stage.started with an ordered timestamp is required",
    );
  return {
    event: {
      ...common,
      type: "stage.completed",
      stage: /** @type {'intent' | 'design' | 'verify'} */ (stage),
      parent: opening.id,
      duration_ms: duration,
    },
  };
}

/** @param {Life} life @param {'unit-started' | 'unit-completed'} operation @returns {Promise<Outcome>} */
export async function unitRecord(life, operation) {
  const unit = life.rest[0] ?? "";
  const found =
    "error" in life.reading
      ? undefined
      : life.reading.plan.units.find((item) => item.id === unit);
  if (life.rest.length !== 1 || !found)
    return rejected(
      "error" in life.reading ? "LIFECYCLE-PLAN" : "LIFECYCLE-ARGS",
      "error" in life.reading
        ? life.reading.error
        : "a Unit ID from the plan is required",
    );
  const id = life.idFor([unit]);
  const ts = life.at(id);
  const common = {
    id,
    v: /** @type {const} */ (1),
    ts,
    actor: /** @type {const} */ ("hook"),
    intent: life.intent,
    unit,
    risk: found.risk,
    ...harnessFields(life.harness),
  };
  if (operation === "unit-started")
    return { event: { ...common, type: "unit.started" } };
  const opening = last(
    life.events,
    (item) =>
      item.type === "unit.started" &&
      item.intent === life.intent &&
      item.unit === unit &&
      live(item),
  );
  const diff = await numstat(life.git);
  const duration = opening ? elapsedMilliseconds(opening.ts, ts) : null;
  if (!opening || duration === null || !diff)
    return rejected(
      "LIFECYCLE-UNMEASURED",
      "a live unit.started and a numeric git diff against HEAD are required",
    );
  return {
    event: {
      ...common,
      type: "unit.completed",
      parent: opening.id,
      duration_ms: duration,
      ...diff,
    },
  };
}
