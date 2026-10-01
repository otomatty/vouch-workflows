import emission from "../../registry/audit-emission.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import {
  canonical,
  createIntentAuditStore,
  intentHome,
  listEvents,
} from "./audit.mjs";
import { readPlan } from "./checkpoints.mjs";
import { newId, now } from "./clock.mjs";
import { readArgs, readIntent } from "./env.mjs";
import { readGit } from "./git.mjs";
import {
  gateRecord,
  learnRecorded,
  reviewRecord,
  sessionEnded,
} from "./lifecycle-close.mjs";
import {
  intentCompleted,
  intentCreated,
  stageRecord,
  unitRecord,
} from "./lifecycle-intent.mjs";
import { fail, harnessOf, live, recorded } from "./lifecycle-shared.mjs";

// Explicit lifecycle records (docs/development/audit-emission.md). Measures come from
// the audit, the plan, review.md or git — never from a number the caller supplies.
/** @typedef {import('./contracts.mjs').AuditEvent} AuditEvent
 * @typedef {import('./contracts.mjs').Harness} Harness
 * @typedef {import('./lifecycle-shared.mjs').Life} Life
 * @typedef {import('./lifecycle-shared.mjs').Outcome} Outcome
 * @typedef {'intent-created'|'intent-completed'|'stage-started'|'stage-completed'|'unit-started'|'unit-completed'|'gate-approved'|'gate-rejected'|'review-requested'|'review-completed'|'learn-recorded'|'session-ended'} Operation
 * @typedef {(...args: string[]) => Promise<string | null>} GitReader */

/**
 * @param {import('./runtime-contracts.mjs').FileStore} files
 * @param {import('./runtime-contracts.mjs').DoctorEnvironment} environment
 * @param {import('./runtime-contracts.mjs').GitStatus} _git
 * @param {{intent?: string | null, args?: string[], now?: () => string, harness?: Harness | null, git?: GitReader}} [ports]
 * @returns {Promise<import('./runtime-contracts.mjs').DoctorReport>}
 */
export async function runLifecycle(files, environment, _git, ports = {}) {
  const intent = ports.intent === undefined ? readIntent() : ports.intent;
  if (!intent) return fail("LIFECYCLE-SCOPE", "VOUCH_INTENT names no Intent");
  let home = "";
  try {
    home = intentHome(intent);
  } catch {
    return fail("LIFECYCLE-SCOPE", "VOUCH_INTENT is not an Intent id");
  }
  const args = ports.args ?? readArgs();
  const [name, ...rest] = args;
  if (
    !emission.operations.includes(/** @type {Operation} */ (name)) ||
    name === undefined
  )
    return fail(
      "LIFECYCLE-ARGS",
      `one of ${emission.operations.join(", ")} is required`,
    );
  const operation = /** @type {Operation} */ (name);
  const clock = ports.now ?? now;
  const harness =
    ports.harness === undefined
      ? harnessOf(environment.installationRoot)
      : ports.harness;
  const git = ports.git ?? readGit(environment.projectRoot);
  const events = await listEvents(createIntentAuditStore(files, intent));
  const reading = readPlan(
    (await files.readText(`${home}/${documents.artifacts.intent}`)) ?? "",
  );
  const idFor = (/** @type {string[]} */ parts) =>
    newId(intent, JSON.stringify([operation, intent, ...parts]));
  // Replay keeps the first live timestamp of this id. A later clock must not conflict.
  const at = (/** @type {string} */ id) =>
    events.find((item) => item.id === id && live(item))?.ts ?? clock();
  /** @type {Life} */
  const life = {
    intent,
    home,
    rest,
    harness,
    events,
    git,
    files,
    reading,
    idFor,
    at,
  };
  const outcome = await record(operation, life);
  if ("rejected" in outcome) return outcome.rejected;
  const { event } = outcome;
  const existing = events.find((item) => item.id === event.id);
  if (existing)
    return canonical(existing) === canonical(event)
      ? recorded(`${event.id} duplicate`)
      : fail("LIFECYCLE-CONFLICT", event.id);
  await createIntentAuditStore(files, intent).append([event]);
  return recorded(event.id);
}

/** @param {Operation} operation @param {Life} life @returns {Promise<Outcome>} */
async function record(operation, life) {
  switch (operation) {
    case "intent-created":
      return intentCreated(life);
    case "intent-completed":
      return intentCompleted(life);
    case "stage-started":
    case "stage-completed":
      return stageRecord(life, operation);
    case "unit-started":
    case "unit-completed":
      return unitRecord(life, operation);
    case "gate-approved":
    case "gate-rejected":
      return gateRecord(life, operation);
    case "review-requested":
    case "review-completed":
      return reviewRecord(life, operation);
    case "learn-recorded":
      return learnRecorded(life);
    case "session-ended":
      return sessionEnded(life);
    default: {
      /** @type {never} */
      const unexpected = operation;
      return { rejected: fail("LIFECYCLE-ARGS", unexpected) };
    }
  }
}
