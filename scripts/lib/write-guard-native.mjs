/** @typedef {import('../native-contracts.mjs').GuardCase} GuardCase */
/** @typedef {import('../native-contracts.mjs').GuardRun} GuardRun */

/** Harnesses may refuse these by themselves, so a control run only records them. */
const recorded = ["link", "registration"];
/** Requests in run order; the registration edit comes last among the denials. */
const cases = /** @type {GuardCase[]} */ ([
  "audit-file",
  "audit-shell",
  "link",
  "approve",
  "registration",
  "draft",
  "read",
]);
/** @type {Partial<Record<GuardCase,string>>} */
const denied = {
  "audit-file": "VOUCH-GUARD-AUDIT",
  "audit-shell": "VOUCH-GUARD-AUDIT",
  link: "VOUCH-GUARD-AUDIT",
  approve: "VOUCH-GUARD-APPROVED",
  registration: "VOUCH-GUARD-INSTALLATION",
};

/** @returns {GuardCase[]} */
export function guardCases() {
  return [...cases];
}

/** The first reason ID in a tool result returned to the model. @param {string} text */
export function guardReason(text) {
  return /VOUCH-GUARD-[A-Z]+/.exec(text)?.[0] ?? null;
}

/** A scripted CLI run is not human consent or a model evaluation.
 * @param {GuardRun} run @returns {string[]} Failed expectation IDs. */
export function verifyGuard(run) {
  const errors = [];
  if (
    JSON.stringify(run.observations.map((item) => item.case)) !==
    JSON.stringify(cases)
  )
    errors.push("GUARD-CASES");
  for (const item of run.observations) {
    const reason = denied[item.case];
    const guarded = run.registration === "guarded";
    if (item.reason !== (guarded ? (reason ?? null) : null))
      errors.push(`${item.case}:GUARD-REASON`);
    if (
      guarded && reason
        ? item.changed
        : !item.expected && (guarded || !recorded.includes(item.case))
    )
      errors.push(`${item.case}:GUARD-EFFECT`);
  }
  if (
    run.registration === "guarded" &&
    (run.forged ||
      JSON.stringify(run.audit) !==
        JSON.stringify([{ type: "session.started", harness: run.harness }]))
  )
    errors.push("GUARD-AUDIT");
  return errors;
}
