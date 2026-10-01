// Shared pieces of the lifecycle command (docs/development/audit-emission.md).

/** @typedef {import('./contracts.mjs').AuditEvent} AuditEvent
 * @typedef {import('./contracts.mjs').Harness} Harness
 * @typedef {import('./contracts.mjs').Risk} Risk
 * @typedef {import('./runtime-contracts.mjs').DoctorReport} DoctorReport
 * @typedef {import('./runtime-contracts.mjs').FileStore} FileStore
 * @typedef {(...args: string[]) => Promise<string | null>} GitReader
 * @typedef {{error: string} | {plan: {risk: Risk, units: {id: string, risk: Risk}[]}}} PlanReading
 * @typedef {{
 *   intent: string,
 *   home: string,
 *   rest: string[],
 *   harness: Harness | null,
 *   events: AuditEvent[],
 *   git: GitReader,
 *   files: FileStore,
 *   reading: PlanReading,
 *   idFor: (parts: string[]) => string,
 *   at: (id: string) => string,
 * }} Life
 * @typedef {{event: AuditEvent} | {rejected: DoctorReport}} Outcome */

/** @param {string} id @param {string} detail @returns {DoctorReport} */
export const fail = (id, detail) => ({
  v: 1,
  ok: false,
  checks: [{ id, ok: false, detail }],
});

/** @param {string} detail @returns {DoctorReport} */
export const recorded = (detail) => ({
  v: 1,
  ok: true,
  checks: [{ id: "LIFECYCLE-RECORDED", ok: true, detail }],
});

/** @param {AuditEvent} event */
const estimated = (event) => "estimated" in event && event.estimated === true;

/** A migration estimate is not a measurement. @param {AuditEvent} event */
export const live = (event) => !event.synthetic && !estimated(event);

/** @param {AuditEvent[]} events @param {(event: AuditEvent) => boolean} choose */
export const last = (events, choose) => events.filter(choose).at(-1);

/** @param {string} root @returns {Harness | null} */
export function harnessOf(root) {
  const name = root.split(/[/\\]/).at(-1);
  if (name === ".claude") return "claude";
  if (name === ".codex") return "codex";
  return null;
}

/** @param {Harness | null} harness */
export const harnessFields = (harness) => (harness ? { harness } : {});
