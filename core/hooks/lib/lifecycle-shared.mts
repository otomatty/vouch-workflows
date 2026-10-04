// Shared pieces of the lifecycle command (docs/development/audit-emission.md).

export type AuditEvent = import("./contracts.mjs").AuditEvent;
export type Harness = import("./contracts.mjs").Harness;
export type Risk = import("./contracts.mjs").Risk;
export type DoctorReport = import("./runtime-contracts.mjs").DoctorReport;
export type FileStore = import("./runtime-contracts.mjs").FileStore;
export type GitReader = (...args: string[]) => Promise<string | null>;
export type PlanReading =
  | { error: string }
  | { plan: { risk: Risk; units: { id: string; risk: Risk }[] } };
export type Life = {
  intent: string;
  home: string;
  rest: string[];
  harness: Harness | null;
  events: AuditEvent[];
  git: GitReader;
  files: FileStore;
  reading: PlanReading;
  idFor: (parts: string[]) => string;
  at: (id: string) => string;
};
export type Outcome = { event: AuditEvent } | { rejected: DoctorReport };

export const fail = (id: string, detail: string): DoctorReport => ({
  v: 1,
  ok: false,
  checks: [{ id, ok: false, detail }],
});

export const recorded = (detail: string): DoctorReport => ({
  v: 1,
  ok: true,
  checks: [{ id: "LIFECYCLE-RECORDED", ok: true, detail }],
});

const estimated = (event: AuditEvent) =>
  "estimated" in event && event.estimated === true;

/** A migration estimate is not a measurement. */
export const live = (event: AuditEvent) =>
  !event.synthetic && !estimated(event);

export const last = (
  events: AuditEvent[],
  choose: (event: AuditEvent) => boolean,
) => events.filter(choose).at(-1);

export function harnessOf(root: string): Harness | null {
  const name = root.split(/[/\\]/).at(-1);
  if (name === ".claude") return "claude";
  if (name === ".codex") return "codex";
  if (name === ".cursor") return "cursor";
  return null;
}

export const harnessFields = (harness: Harness | null) =>
  harness ? { harness } : {};
