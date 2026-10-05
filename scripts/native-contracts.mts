/** Manual CLI exercises use disposable directories, never the user's configuration. */
export type NativeScope = {
  /** Absolute isolated CODEX_HOME. */
  home: string;
  /** Absolute isolated project root. */
  project: string;
  /** Explicit disposable Intent identifier. */
  intent: string;
};
export type NativeSubmission = {
  event: "gate.opened" | "intent.approved";
  observed: boolean;
  /** CLI exit code, not the hook exit code. */
  exitCode: number | null;
  /** Observation ended by the exercise. */
  terminatedByController: boolean;
};
export type ListedHook = {
  key: string;
  eventName: string;
  currentHash: string;
  sourcePath: string;
  source: string;
  /** Installed-registration exercises; expectations are in docs/development/harness-fixtures.md. `no-root` is recorded without a verdict. */
  command: string;
};
export type PropagationCase =
  | "allow"
  | "open"
  | "invalid"
  | "corrupt"
  | "no-intent"
  | "no-root";
export type PropagationObservation = {
  case: PropagationCase;
  harness: "claude" | "codex";
  interactive: boolean;
  /** CLI exit code; null when the exercise ended the CLI. */
  exitCode: number | null;
  /** Provider conversation requests that carried the prompt. */
  promptRequests: number;
  /** Audit rows after the exercise. */
  events: unknown[];
  auditExists: boolean;
  /** Audit bytes equal what the exercise prepared. */
  auditUnchanged: boolean;
  /** CLI stdout and stderr, or the terminal log without escape sequences. Scripted tool requests against a copied registration; see docs/development/write-guard.md. */
  output: string;
};
export type GuardCase =
  | "audit-file"
  | "audit-shell"
  | "registration"
  | "approve"
  | "link"
  | "draft"
  | "read";
export type GuardObservation = {
  case: GuardCase;
  /** Tool the provider requested. */
  tool: string;
  /** First VOUCH-GUARD-* ID in the tool result returned to the model. */
  reason: string | null;
  /** Tool result text returned to the model, shortened. */
  result: string;
  /** The target bytes differ after the run. */
  changed: boolean;
  /** The target (or, for read, the result) holds the requested effect. */
  expected: boolean;
};
export type GuardRun = {
  harness: "claude" | "codex";
  cliVersion: string;
  platform: string;
  nodeVersion: string;
  /** Control removes only PreToolUse from the copy. */
  registration: "guarded" | "control";
  /** CLI exit code, not the hook exit code. */
  exitCode: number | null;
  observations: GuardObservation[];
  /** Audit records after the run. */
  audit: { type: unknown; harness: unknown }[];
  /** A scripted forged record reached the audit. */
  forged: boolean;
  /** Expectation IDs the check reported. Scripted approval inputs and implementation writes; see docs/development/approval-boundary.md. */
  errors: string[];
};
export type ApprovalStep =
  | "write-before"
  | "confirm-acceptance"
  | "confirm-scope"
  | "confirm-units"
  | "review"
  | "approve"
  | "write-after";
export type ApprovalObservation = {
  step: ApprovalStep;
  /** CLI exit code; null when the exercise ended the CLI. */
  exitCode: number | null;
  /** Provider conversation requests that carried the prompt. */
  promptRequests: number;
  /** First VOUCH-* ID in the tool result (writes) or CLI output (inputs). */
  reason: string | null;
  /** The scripted implementation file exists after the step. */
  written: boolean;
  /** intent.md status after the step; null when unsupported. */
  status: "draft" | "approved" | null;
};
export type ApprovalRun = {
  harness: "claude" | "codex";
  cliVersion: string;
  platform: string;
  nodeVersion: string;
  observations: ApprovalObservation[];
  /** Audit records after the run. */
  audit: { type: unknown; harness: unknown; synthetic: unknown }[];
  /** The approved intent.md has the revision of the prepared draft. */
  revisionKept: boolean;
  /** Expectation IDs the check reported. */
  errors: string[];
};
