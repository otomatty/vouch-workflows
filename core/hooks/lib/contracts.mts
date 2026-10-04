/** Contracts only. No I/O, parsing, emission, or authorization is implemented here. JSON Schema is the wire contract; these types describe values after validation. Numeric bounds, cross-record references and filesystem containment need runtime checks. */
export type Stage = "intent" | "design" | "build" | "verify";
export type Risk = "L" | "M" | "H";
export type Harness = "claude" | "codex" | "cursor";
export type Actor = "model" | "hook" | "human" | "reviewer";
export type Check = "contract" | "dod" | "freshness" | "citation" | "format";
export type Tokens = { in: number; out: number; cache?: number };
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | unknown[]
  | JsonObject;
export type JsonObject = { [key: string]: unknown };

/** A missing measurement means unavailable; it never means zero. `synthetic` labels authored schema examples and cannot authenticate a real event. */
export type AuditBase = {
  /** Deterministically derived from session and input identity. */
  id: string;
  v: 1;
  /** UTC timestamp. */
  ts: string;
  actor: Actor;
  intent?: string;
  stage?: Stage;
  unit?: string;
  session?: string;
  /** Matching start/request ID; never evidence of human approval alone. */
  parent?: string;
  duration_ms?: number;
  wait_ms?: number;
  synthetic?: true;
};

/** Provenance of a record migrated from v2 (docs/development/migrate.md); only the converted types and legacy.* carry it. `original_type`: the v2 event name, or UNTYPED for a block without one. `raw`: the original block text, never rewritten. `source_path`: the project-relative v2 file and first line (`path#Ln`). `estimated`: a time or duration derived from neighbouring records, never a measurement. */
export type MigratedOrigin = {
  original_type?: string;
  raw?: string;
  source_path?: string;
  estimated?: true;
};

export type AuditCommon = AuditBase &
  (
    | { harness: "claude"; tokens?: Tokens }
    | { harness?: Harness; tokens?: never }
  );
/** Optional on historical audit records, mandatory for evidence comparison. Digests and IDs bind data; they do not prove human consent or trusted provenance. */
export type IntentRevision = { path: "intent.md"; sha256: string };
export type Submission = {
  hook_event_name: "UserPromptSubmit";
  field: "prompt_id" | "turn_id";
  id: string;
  prompt_sha256: string;
};
/** `content` digests the confirmed part only: an intent.md section or Unit row, or the normalized design.md, one of its sections, or it without the other Units' rows. */
export type IntentApprovalEvidence = (
  | { harness: "claude"; submission: Submission & { field: "prompt_id" } }
  | {
      harness: "codex" | "cursor";
      submission: Submission & { field: "turn_id" };
    }
) & { session: string; revision: IntentRevision };
export type CheckpointContent = {
  path: "intent.md" | "design.md";
  sha256: string;
};
export type CheckpointEvidence = (
  | { harness: "claude"; submission: Submission & { field: "prompt_id" } }
  | {
      harness: "codex" | "cursor";
      submission: Submission & { field: "turn_id" };
    }
) & { session: string; content: CheckpointContent };
export type IntentCreated = AuditCommon & {
  type: "intent.created";
  intent: string;
  risk: Risk;
};
export type IntentApproved = AuditCommon & {
  type: "intent.approved";
  intent: string;
  actor: "human";
  source: "intent";
  parent: string;
  wait_ms: number;
} & ({ revision?: never; submission?: never } | IntentApprovalEvidence);
export type IntentCompleted = AuditCommon & {
  type: "intent.completed";
  intent: string;
  parent: string;
  duration_ms: number;
  ai_work_ms: number;
  human_wait_ms: number;
  human_review_ms: number;
};
export type StageStarted = AuditCommon &
  MigratedOrigin & { type: "stage.started"; intent: string; stage: Stage };
export type StageCompleted = AuditCommon &
  MigratedOrigin & {
    type: "stage.completed";
    intent: string;
    parent: string;
    duration_ms: number;
  } & (
    | { stage: "build"; loop_iterations: number; tests: number }
    | {
        stage: Exclude<Stage, "build">;
        loop_iterations?: number;
        tests?: number;
      }
  );
export type UnitStarted = AuditCommon & {
  type: "unit.started";
  intent: string;
  unit: string;
  risk: Risk;
};
export type UnitCompleted = AuditCommon & {
  type: "unit.completed";
  intent: string;
  unit: string;
  risk: Risk;
  parent: string;
  duration_ms: number;
  files_changed: number;
  lines_changed: number;
};
export type CheckpointConfirmed = AuditCommon & {
  type: "checkpoint.confirmed";
  intent: string;
  actor: "human";
} & (
    | {
        checkpoint: "acceptance" | "scope" | "units" | "design";
        section?: string;
      }
    | { checkpoint: "design"; unit: string }
    | { checkpoint: "unit"; unit: string }
    | { checkpoint: "section"; section: string }
  ) &
  ({ content?: never; submission?: never } | CheckpointEvidence);
export type GateOpened = AuditCommon & {
  type: "gate.opened";
  intent: string;
  source: "intent" | "pr";
} & (
    | { revision?: never }
    | {
        revision: IntentRevision;
        source: "intent";
        actor: "hook";
        harness: Harness;
        session: string;
      }
  );
export type GateApproved = AuditCommon & {
  type: "gate.approved";
  intent: string;
  actor: "human";
  source: "intent" | "pr";
  parent: string;
  wait_ms: number;
};
export type GateRejected = AuditCommon & {
  type: "gate.rejected";
  intent: string;
  actor: "human";
  source: "intent" | "pr";
  parent: string;
  wait_ms: number;
  reason: string;
};
/** `card` digests the decisions.md card without its answer section; an answer binds to that version. */
export type QuestionAsked = AuditCommon & {
  type: "question.asked";
  intent: string;
  question: string;
  options: number;
  card?: { path: "decisions.md"; sha256: string };
} & (
    | { blocking: false; default: string }
    | { blocking: true; default?: string }
  );
export type QuestionAnswered = AuditCommon & {
  type: "question.answered";
  intent: string;
  actor: "human";
  question: string;
  choice: string;
  parent: string;
  wait_ms: number;
};
export type QuestionDefaulted = AuditCommon & {
  type: "question.defaulted";
  intent: string;
  question: string;
  choice: string;
  parent: string;
  wait_ms: number;
};
export type AsideAsked = AuditCommon & {
  type: "aside.asked";
  intent: string;
  question: string;
};
/** `answer`: the bounded final message of the asking turn when the harness supplied it. */
export type AsideAnswered = AuditCommon & {
  type: "aside.answered";
  intent: string;
  question: string;
  parent: string;
  duration_ms: number;
  answer?: string;
};
/** `exit_code` is absent when the command did not run to an exit. */
export type DodCommand = {
  target: string;
  command: string;
  cwd: string;
  result: "pass" | "fail";
  duration_ms: number;
  exit_code?: number;
};
export type KnowledgeObservation = {
  sha256: string;
  generation?: string;
  head?: string;
};
export type HookCheck = AuditCommon & {
  knowledge?: KnowledgeObservation;
  type: "hook.check";
  actor: "hook";
  check: Check;
  result: "pass" | "fail";
  duration_ms: number;
  missing?: number;
  stale?: number;
} & (
    | { commit?: never; clean?: never; commands?: never; output?: never }
    | {
        check: "dod";
        commit?: string;
        clean: boolean;
        commands: DodCommand[];
        output: { path: "build-log.md"; sha256: string };
      }
  );
export type HookDenied = AuditCommon & {
  knowledge?: KnowledgeObservation;
  type: "hook.denied";
  actor: "hook";
  check: Check;
  result: "fail";
  reason: string;
  duration_ms: number;
};
export type ReviewRequested = AuditCommon & {
  type: "review.requested";
  intent: string;
  iteration: number;
  harness: Harness;
};
export type ReviewCompleted = AuditCommon & {
  type: "review.completed";
  intent: string;
  iteration: number;
  harness: Harness;
  findings: number;
  sabotage: { tried: number; caught: number };
  parent: string;
  duration_ms: number;
};
export type KnowledgeRefreshed = AuditCommon & {
  knowledge?: KnowledgeObservation;
  type: "knowledge.refreshed";
  scope: "diff" | "full";
  duration_ms: number;
};
export type SessionStarted = AuditCommon & {
  type: "session.started";
  session: string;
};
export type SessionResumed = AuditCommon & {
  type: "session.resumed";
  session: string;
  duration_ms: number;
};
export type SessionCompacted = AuditCommon & {
  type: "session.compacted";
  session: string;
};
export type SessionEnded = AuditCommon & {
  type: "session.ended";
  session: string;
  parent: string;
  duration_ms: number;
};
export type LearnRecorded = AuditCommon &
  MigratedOrigin & {
    type: "learn.recorded";
    intent: string;
    rules_added: number;
  };
/** `revision` binds the person's `vouch migrate approve` to the migration.md bytes it named. */
export type MigrationCompleted = AuditCommon & {
  type: "migration.completed";
  files_migrated: number;
} & (
    | { revision?: never; submission?: never }
    | {
        actor: "human";
        revision: { path: "migration.md"; sha256: string };
        submission: Submission;
        harness: Harness;
        session: string;
      }
  );
export type LegacyEvent = AuditCommon & {
  type: `legacy.${string}`;
  original_type: string;
  raw: string;
  source_path: string;
  estimated?: true;
};
export type AuditEvent =
  | IntentCreated
  | IntentApproved
  | IntentCompleted
  | StageStarted
  | StageCompleted
  | UnitStarted
  | UnitCompleted
  | CheckpointConfirmed
  | GateOpened
  | GateApproved
  | GateRejected
  | QuestionAsked
  | QuestionAnswered
  | QuestionDefaulted
  | AsideAsked
  | AsideAnswered
  | HookCheck
  | HookDenied
  | ReviewRequested
  | ReviewCompleted
  | KnowledgeRefreshed
  | SessionStarted
  | SessionResumed
  | SessionCompacted
  | SessionEnded
  | LearnRecorded
  | MigrationCompleted
  | LegacyEvent;
/** find and list return detached records in file order. Mutating them cannot alter future reads or writes. Each lookup and valid nonempty append rereads the file. Validation may reuse only an exactly equal previously validated text snapshot, including the read under the write lock. */
export type AuditStore = {
  append: (events: AuditEvent[]) => Promise<"appended" | "duplicate">;
  find?: (id: string) => Promise<AuditEvent | undefined>;
  list?: () => Promise<AuditEvent[]>;
};

/** Raw harness payload after structural validation. Unknown fields are accepted by the schema and discarded by parseInput. `cwd` is untrusted input. */
export type HookInputBase = {
  session_id: string;
  cwd: string;
  transcript_path?: string;
  model?: string;
  permission_mode?: string;
  /** Claude UserPromptSubmit identity, preserved from captured input. */
  prompt_id?: string;
  turn_id?: string;
  tool_use_id?: string;
  agent_type?: string;
  agent_transcript_path?: string;
  last_assistant_message?: string;
  /** Present only when the payload carried Claude-shaped usage. Codex emitters omit it. */
  tokens?: Tokens;
};
export type HookInput = HookInputBase &
  (
    | { hook_event_name: "SessionStart"; source: string }
    | { hook_event_name: "UserPromptSubmit"; prompt: string }
    | {
        hook_event_name: "PreToolUse";
        tool_name: string;
        tool_input: JsonObject;
      }
    | {
        hook_event_name: "PostToolUse";
        tool_name: string;
        tool_input: JsonObject;
        tool_response: JsonValue;
      }
    | { hook_event_name: "PreCompact"; trigger: string }
    | {
        hook_event_name: "SubagentStop";
        agent_id: string;
        stop_hook_active?: boolean;
      }
    | { hook_event_name: "Stop"; stop_hook_active: boolean }
  );

/** Complete audit records, not raw stdin or a harness-specific stdout response. `deny` requires a nonempty reason. io.run appends validated records, then reports denial on stderr with exit 2. `context` is plain text io.run writes to stdout after the append succeeds; harnesses add SessionStart stdout to the model's context. It carries observations, never instructions or approvals. `approve` asks io.run, after the append succeeds, to turn the configured Intent's draft of that revision into approved; any other current text fails the run instead (docs/development/approval-boundary.md). */
export type ApproveTransition = { sha256: string };
export type HookResult =
  | {
      decision: "allow";
      reason?: string;
      events?: AuditEvent[];
      context?: string;
    }
  | {
      decision: "deny";
      reason: string;
      events?: AuditEvent[];
      approve?: ApproveTransition;
    };
export type HookProcessResult =
  | { exitCode: 0; stdout: JsonValue; stderr: string }
  | { exitCode: 2; stdout: JsonValue; stderr: string };

/** Dependencies are supplied by the wrapper, never trusted from stdin. */
export type HookContext = {
  /** Trusted root; resolved paths still need containment checks. */
  projectRoot: string;
  /** Selected by installation, not payload claims. */
  harness: Harness;
  /** Explicit installed scope, never derived from stdin. */
  intent?: string;
  /** io supplies contained UTF-8 artifact reads. */
  readText?: (path: string) => Promise<string | null>;
  /** io supplies the configured intent store. Session recording requires find(); approval and the build boundary also require list(). */
  audit?: AuditStore;
  /** Knowledge generation to compare with citations. */
  generation: string;
  /** UTC time supplied by clock.mjs. */
  now: () => string;
  /** Deterministic event identity. */
  newId: (session: string, inputIdentity: string) => string;
};
/** io validates FileStore before invoking main. PreToolUse paths are classified by main through locate. */
export type ReadyHookContext = HookContext & {
  readText: (path: string) => Promise<string | null>;
  locate: (
    path: string,
    from?: string,
  ) => Promise<import("./runtime-contracts.mjs").PathLocation>;
};
export type HookMain = (
  input: HookInput,
  ctx: ReadyHookContext,
) => HookResult | Promise<HookResult>;

/** Missing version on imported evidence is preserved, never guessed from `model`. Only nonsynthetic records with a known harness version qualify for TEST-7. */
export type HarnessFixture = {
  /** Captured fixture inventory; Cursor adapter examples are separate synthetic tests. */
  harness: "claude" | "codex";
  version: string | null;
  synthetic: boolean;
  provenance: "imported" | "captured" | "synthetic";
  source?: { path: string; commit: string; key: string };
  payload: HookInput;
};
