export type GuardCase = import("../native-contracts.mjs").GuardCase;
export type GuardRun = import("../native-contracts.mjs").GuardRun;

/** Harnesses may refuse these by themselves, so a control run only records them. */
const recorded = ["link", "registration"];
/** Requests in run order; the registration edit comes last among the denials. */
const cases = [
  "audit-file",
  "audit-shell",
  "link",
  "approve",
  "registration",
  "draft",
  "read",
] as GuardCase[];
const denied: Partial<Record<GuardCase, string>> = {
  "audit-file": "VOUCH-GUARD-AUDIT",
  "audit-shell": "VOUCH-GUARD-AUDIT",
  link: "VOUCH-GUARD-AUDIT",
  approve: "VOUCH-GUARD-APPROVED",
  registration: "VOUCH-GUARD-INSTALLATION",
};

export function guardCases(): GuardCase[] {
  return [...cases];
}

/** The first reason ID in a tool result returned to the model. */
export function guardReason(text: string) {
  return /VOUCH-GUARD-[A-Z]+/.exec(text)?.[0] ?? null;
}

/** A scripted CLI run is not human consent or a model evaluation. @returns Failed expectation IDs. */
export function verifyGuard(run: GuardRun): string[] {
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
