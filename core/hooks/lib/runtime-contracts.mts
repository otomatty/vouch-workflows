/** Runtime boundary contracts. Paths and audit contents remain untrusted until checked. */
export type AuditEvent = import("./contracts.mjs").AuditEvent;
export type HookContext = import("./contracts.mjs").HookContext;
export type Clock = {
  now: () => string;
  newId: (session: string, identity: string) => string;
};
export type TextUpdate = (before: string | null) => string | null;
export type FileStore = {
  /** Return the canonical-root target. An absolute spelling through an alias of the root directory maps to it; escapes, links below the root and nonregular files are rejected. */
  resolvePath: (path: string) => Promise<string>;
  /** Return null only for a missing file. */
  readText: (path: string) => Promise<string | null>;
  /** Serialize with a lock; replace atomically. */
  updateText: (path: string, update: TextUpdate) => Promise<boolean>;
  /** Write through updateText. */
  writeText: (path: string, text: string) => Promise<boolean>;
  /** Exact bytes of a regular file; null only when missing. */
  readBytes: (path: string) => Promise<Buffer | null>;
  /** Create once under the update lock: false when the file already has exactly these bytes; FS-CONFLICT when it has others. Never replaces content. */
  createBytes: (path: string, bytes: Uint8Array) => Promise<boolean>;
  /** Direct children in code-unit order; null when missing. */
  list: (path: string) => Promise<DirectoryEntry[] | null>;
  /** Classify without trusting the spelling: resolve against `from` (default: the root) with the platform's separators, map the deepest existing ancestor to its real path and append the rest. Outside, linked and missing paths are results, not errors; a component that cannot be looked up for any reason (denied, looping, too long) counts as missing, so a single word never fails the guard open. Where a spelled path lands after links, junctions, root aliases and 8.3 names are followed. */
  locate: (path: string, from?: string) => Promise<PathLocation>;
};
export type PathLocation = {
  /** Canonical path below the canonical root, "/"-separated; "" is the root; null outside. */
  inside: string | null;
  /** The canonical path is the root or one of its ancestors. */
  contains: boolean;
  /** Absolute canonical path after following links; lexical below the deepest existing ancestor. */
  canonical: string;
  /** After following links; unresolved is a dangling or looping link, or a target that could not be examined after it was found. */
  kind: "file" | "directory" | "missing" | "other" | "unresolved";
  /** Hard link count of an existing regular file; 0 otherwise. */
  links: number;
};
/** `link`: a symbolic link or a hard-linked file. */
export type DirectoryEntry = {
  name: string;
  kind: "file" | "directory" | "link" | "other";
};
export type AuditStore = import("./contracts.mjs").AuditStore;
export type RuntimeOptions = {
  /** Trusted installation configuration. Otherwise use env.mjs. */
  context?: HookContext;
  stdin?: AsyncIterable<Uint8Array | string>;
  stdout?: { write: (text: string) => unknown };
  stderr?: { write: (text: string) => unknown };
  finish?: (code: 0 | 2) => void;
  files?: FileStore;
  /** Required when main returns events; never inferred from stdin. */
  audit?: AuditStore;
};

/** Manual distribution diagnostic, separate from the stdin hook protocol. No configuration repair, audit writes, or harness trust claims. */
export type DoctorEnvironment = {
  projectRoot: string;
  installationRoot: string;
  nodeVersion: string;
  runtimeRoot?: string;
  harness?: import("./contracts.mjs").Harness;
};
export type DoctorCheck = { id: string; ok: boolean; detail: string };
export type DoctorReport = { v: 1; ok: boolean; checks: DoctorCheck[] };
export type GitStatus = { ok: boolean; detail: string };
export type DoctorMain = (
  files: FileStore,
  environment: DoctorEnvironment,
  git: GitStatus,
) => Promise<DoctorReport>;
export type DoctorOptions = {
  environment?: DoctorEnvironment;
  files?: FileStore;
  git?: () => GitStatus;
  stdout?: { write: (text: string) => unknown };
  finish?: (code: 0 | 2) => void;
};

/** Pure evidence comparison, never an authorization decision or event producer. Caller supplies the separately observed, validated input and installed scope. A match also occurs for synthetic data; provenance and consent need future hooks. */
export type IntentSnapshot = {
  status: "draft" | "approved";
  revision: import("./contracts.mjs").IntentRevision;
};
export type SnapshotIntent = (text: string) => IntentSnapshot | null;
/** The text with its status line read as draft; null without the single-status frontmatter that snapshots require. */
export type DraftText = (
  text: string,
) => { status: "draft" | "approved"; text: string } | null;
export type IdentifySubmission = (
  input: import("./contracts.mjs").HookInput,
  harness: import("./contracts.mjs").Harness,
) => import("./contracts.mjs").Submission | null;
export type ApprovalComparisonInput = {
  gate: unknown;
  approval: unknown;
  input: import("./contracts.mjs").HookInput;
  harness: import("./contracts.mjs").Harness;
  intent: string;
  text: string;
};
export type ApprovalMismatch =
  | "invalid-record"
  | "missing-evidence"
  | "scope"
  | "parent"
  | "revision"
  | "submission"
  | "wait";
export type ApprovalComparison =
  | { matches: true }
  | { matches: false; reason: ApprovalMismatch };
export type CompareIntentApprovalEvidence = (
  value: ApprovalComparisonInput,
) => ApprovalComparison;
export type ElapsedMilliseconds = (start: string, end: string) => number | null;

/** Explicit operator inputs only. No inference of consent from ordinary text. */
export type IntentReviewCommand =
  | { kind: "open" }
  | { kind: "approve"; gate: string }
  | { kind: "confirm"; target: CheckpointTarget }
  | { kind: "invalid" }
  | null;
export type ParseIntentReviewCommand = (prompt: string) => IntentReviewCommand;
/** Records explicit review, checkpoint and approval inputs; asks io to apply approval only for an approval input whose own record matches it and when every required checkpoint matches the current texts. */
export type ReviewIntent = (
  input: import("./contracts.mjs").HookInput,
  ctx: import("./contracts.mjs").ReadyHookContext,
) => Promise<import("./contracts.mjs").HookResult>;

/** Approval boundary (docs/development/approval-boundary.md). Pure functions over texts the caller read and validated audit records; they never read files, record events or trust actor claims. */
export type TopicCheckpoint = "acceptance" | "scope" | "units" | "design";
/** `design` alone is the whole design.md; with `section` one design.md section, with `unit` the design.md without the other Units' rows of its units table, so shared parts stay covered for every Unit. */
export type CheckpointTarget =
  | { checkpoint: TopicCheckpoint }
  | { checkpoint: "unit"; unit: string }
  | { checkpoint: "section"; section: string }
  | { checkpoint: "design"; unit: string }
  | { checkpoint: "design"; section: string };
export type CheckpointMode = "topic" | "unit" | "section";
/** `design`: declared required. */
export type PlanUnit = {
  id: string;
  risk: import("./contracts.mjs").Risk;
  design: boolean;
};
/** `risk`: highest Unit; `design`: an H Unit or a declared requirement. */
export type Plan = {
  units: PlanUnit[];
  risk: import("./contracts.mjs").Risk;
  design: boolean;
};
export type PlanReading = { plan: Plan } | { error: string };
/** The first table of the plan section, in registry grammar. */
export type ReadPlan = (text: string) => PlanReading;
/** A missing rules.md (null) is the workflow default; unreadable, duplicate or unknown settings are null, never the default. */
export type ReadCheckpointMode = (text: string | null) => CheckpointMode | null;
export type RequiredCheckpoints = (
  mode: CheckpointMode,
  plan: Plan,
) => CheckpointTarget[];
export type ArtifactTexts = { intent: string; design: string | null };
/** Digest of the exact confirmed bytes; null when the target is absent or not unique. */
export type CheckpointContentOf = (
  target: CheckpointTarget,
  texts: ArtifactTexts,
) => import("./contracts.mjs").CheckpointContent | null;
/** "acceptance", "unit U1", "section plan", "design unit U1", "design section ideal". */
export type DescribeTarget = (target: CheckpointTarget) => string;
export type NewId = (session: string, identity: string) => string;
export type CheckpointQuery = {
  required: CheckpointTarget[];
  events: AuditEvent[];
  intent: string;
  texts: ArtifactTexts;
  newId: NewId;
};
/** Required targets without a nonsynthetic, derived-identity confirmation of the current content, in required order. */
export type MissingCheckpoints = (query: CheckpointQuery) => CheckpointTarget[];
export type ApprovalQuery = {
  /** Current intent.md, draft or approved. */
  text: string;
  events: AuditEvent[];
  intent: string;
  newId: NewId;
};
/** The first approval of the text's revision whose derived identity, parent gate, scope and wait all match. */
export type FindApproval = (
  query: ApprovalQuery,
) => import("./contracts.mjs").IntentApproved | null;
/** The approved text of a draft or approved document of that revision, with only the status value changed; null for any other text. */
export type ApprovedText = (text: string, sha256: string) => string | null;
/** PreToolUse file edits outside vouch/ or to the configured Intent's build and verify artifacts wait for an approved plan with evidence; unreadable evidence denies. */
export type GuardBuild = (
  input: import("./contracts.mjs").HookInput,
  ctx: import("./contracts.mjs").ReadyHookContext,
) => Promise<import("./contracts.mjs").HookResult>;

/** PreToolUse write guard (docs/development/write-guard.md). Stateless: it never writes, locks or records, and grants nothing from tool_input contents such as actor fields. A deny names the first matching area; allow means only that no inspected route names a protected target. */
export type GuardArea = "audit" | "lock" | "installation" | "artifact";
/** `ancestor`: the path contains the area. */
export type GuardMatch = { area: GuardArea; ancestor: boolean };
export type GuardScope = {
  /** Normalized segments of the installation directory below the root, or null. */
  installation: string[] | null;
  /** Normalized protected entry names inside the installation directory. */
  installed: string[];
  /** Native directory of a managed installation, including its activation configuration. */
  managed?: string;
  /** Trusted absolute hooks directory for managed manual commands outside the project. */
  runtime?: string;
  /** Canonical root of the managed runtime running the guard; aliases resolve to it. */
  runtimeRoot?: string;
};
/** Segments are root-relative; glob segments may match any name at their position. */
export type ClassifySegments = (
  segments: string[],
  scope: GuardScope,
) => GuardMatch | null;
/** Lower case without trailing dots, spaces or `:stream`. */
export type NormalizeSegment = (segment: string) => string;
/** A superset of the approved texts snapshotIntent reads. */
export type DeclaresApproved = (text: string) => boolean;
export type PatchOperation = {
  kind: "add" | "update" | "delete";
  path: string;
  to: string | null;
  added: string[];
};
/** Marker lines anywhere; unknown text is ignored. */
export type ParsePatch = (text: string) => PatchOperation[];
/** One simple command; keywords and operators are not words. */
export type ShellCommand = {
  /** Unquoted words, redirection targets and here-document text included. */
  words: string[];
  /** Per word: unquoted glob, `{` or `~`, or `$` outside single quotes. */
  expands: boolean[];
  /** An output redirection to anything but /dev/null or a descriptor. */
  writes: boolean;
  /** Subshell nesting at the start of the command. */
  depth: number;
};
/** `dynamic`: substitutions decided at run time. */
export type ShellParse = { commands: ShellCommand[]; dynamic: boolean };
/** POSIX-like words only; no expansion or execution. */
export type ParseShell = (text: string) => ShellParse;
export type ReadsOnly = (
  command: ShellCommand,
  doctor: (word: string) => boolean,
) => boolean;
/** Bash brace expansion; an integer sequence keeps its first value; null past 256 results. */
export type ExpandBraces = (word: string) => string[] | null;
/** Drops `#` comments only while POSIX shells and PowerShell read every earlier character alike. */
export type Uncommented = (text: string) => string;
/** `entry` is the hook file itself, as a path or file URL; the installation directory is never taken from stdin. */
export type GuardWrites = (
  input: import("./contracts.mjs").HookInput,
  ctx: import("./contracts.mjs").ReadyHookContext,
  entry: string,
) => Promise<import("./contracts.mjs").HookResult>;

/** Git operations and DoD evidence (docs/development/git-guard.md). Only the process port runs programs. */
/** A `--name-status --no-renames` entry; paths are root-relative. */
export type Change = [status: string, path: string];
export type Commit = { sha: string; subject: string; changes: Change[] };
export type Spawned = {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: Error;
};
export type SpawnPort = (
  file: string,
  args: string[],
  options: import("node:child_process").SpawnSyncOptions,
) => Spawned;
/** Hidden window; a shell only when asked; Git within gitTimeoutMs. */
export type Spawn = (
  file: string,
  args: string[],
  options: import("node:child_process").SpawnSyncOptions,
  execute?: SpawnPort,
) => Promise<Spawned>;
/** Stdout of a read-only Git command; null on failure. */
export type GitPort = (...args: string[]) => Promise<string | null>;
/** `--no-optional-locks` Git in `cwd`, then each `-C` step. */
export type ReadGit = (
  cwd: string,
  execute?: SpawnPort,
  steps?: string[],
) => GitPort;
export type IsShellTool = (
  harness: import("./contracts.mjs").Harness,
  tool: string,
) => boolean;
/** A registered `<type>(<Unit>): ` subject. */
export type CommitType = (
  subject: string,
) => { type: string; unit: string } | null;
/** Entries of `--name-status -z` output. */
export type ReadChanges = (text: string) => Change[];
/** Non-merge commits of `rev` (HEAD) outside every protected branch, oldest first; empty for an unknown `rev`; null when unreadable or `rev` starts with `-`. */
export type BranchHistory = (
  git: GitPort,
  rev?: string,
) => Promise<Commit[] | null>;
export type Proven = (sha: string, kind: "pass" | "fail") => boolean;
/** Clean, nonsynthetic, derived-ID dod checks of the Intent; `fail` needs a nonzero exit. */
export type DodEvidence = (
  events: AuditEvent[],
  intent: string,
  newId: NewId,
) => Proven;
/** The first broken rule and its registry detail; `earlier` holds the branch commits before it, oldest first. */
export type CommitViolation = (
  commit: { subject: string; changes: Change[] },
  earlier: Commit[],
  units: string[],
  proven: Proven,
) => ["type" | "unit" | "test" | "order", string] | null;
/** The last code commit of a branch with a feat or fix, unless a DoD passed there. */
export type UnprovenTip = (log: Commit[], proven: Proven) => Commit | null;
/** Shell pushes to a protected branch and `gh pr merge` deny; with an Intent, pushes and `-m` commits of the project that break a rule deny. */
export type GuardGit = (
  input: import("./contracts.mjs").HookInput,
  ctx: import("./contracts.mjs").ReadyHookContext,
  execute?: SpawnPort,
) => Promise<import("./contracts.mjs").HookResult>;
/** `secrets`: values the DoD output never keeps. */
export type DodPorts = {
  intent: string | null;
  now: () => string;
  execute?: SpawnPort;
  secrets?: string[];
};
/** Runs the rules.md DoD for an approved plan, appends build-log.md, then one hook.check record. */
export type RunDod = (
  files: FileStore,
  environment: DoctorEnvironment,
  git: GitStatus,
  ports?: DodPorts,
) => Promise<DoctorReport>;

/** Resume, ask, questions, report and statusline (docs/development/resume.md). Observation only: these functions never decide the next step, approve, confirm, answer or apply a default on their own. */
/** Registered events in file order; `invalid`: 1-based lines that are not one registered event (a line without its final newline included); `duplicates`: IDs repeated after their first record, which alone is kept. */
export type AuditScan = {
  events: AuditEvent[];
  invalid: number[];
  duplicates: string[];
};
/** Unlike the store, a damaged line never hides the rest. */
export type ScanAudit = (text: string | null) => AuditScan;
/** `status`: the raw single frontmatter value, never interpreted; null when absent or unreadable. `unreadable`: present but not readable (a link, a non-regular file, invalid UTF-8). */
export type ArtifactObservation = {
  stage: import("./contracts.mjs").Stage;
  path: string;
  present: boolean;
  status: string | null;
  unreadable?: true;
};
/** Synthetic records are counted, never used as evidence. Invalid lines, repeated IDs or an unreadable log make every claim partial; an unreadable log is never read as an empty one. */
export type AuditObservation = {
  path: string;
  events: number;
  synthetic: number;
  invalid: number[];
  duplicates: string[];
  unreadable?: true;
};
/** Described targets; `missing` lacks a confirmation of the current content. */
export type CheckpointObservation =
  | { state: "unknown"; reason: string }
  | { state: "observed"; required: string[]; missing: string[] };
/** `declared`: approved without matching evidence. */
export type ApprovalObservation = "none" | "evidence" | "declared";
/** Asked, neither answered nor defaulted. */
export type OpenQuestion = {
  question: string;
  event: string;
  default?: string;
};
/** A default the model applied while no person answered. */
export type DefaultedQuestion = {
  question: string;
  event: string;
  choice: string;
  defaulted: string;
};
export type Position = {
  intent: string;
  /** rules.md language, else the workflow default. */
  language: "ja" | "en";
  /** In workflow stage order. */
  artifacts: ArtifactObservation[];
  audit: AuditObservation;
  checkpoints: CheckpointObservation;
  approval: ApprovalObservation;
  unanswered: OpenQuestion[];
  defaulted: DefaultedQuestion[];
  /** IDs of question records whose pairing cannot be established. */
  uncertain: string[];
};
export type PositionReader = {
  readText: (path: string) => Promise<string | null>;
  newId: NewId;
};
/** Unreadable files are observations, not errors. */
export type ReadPosition = (
  reader: PositionReader,
  intent: string,
) => Promise<Position>;
/** Untrusted strings are quoted and bounded. */
export type FormatPosition = (position: Position) => string;
/** Option IDs in table order; no default means blocking. `sha256` digests the card without its answer section, so recording an answer keeps it. */
export type QuestionCard = {
  options: string[];
  default?: string;
  sha256: string;
};
export type ReadQuestionCard = (
  text: string | null,
  question: string,
) => QuestionCard | { error: string };
export type QuestionPorts = {
  intent: string | null;
  args: string[];
  now: () => string;
};
/** `ask <Q-n>` records question.asked from the decisions.md card and its digest, refusing a changed card; `default <Q-n>` records question.defaulted with the recorded default while no answer exists. Neither answers, confirms or approves. */
export type RunQuestion = (
  files: FileStore,
  environment: DoctorEnvironment,
  git: GitStatus,
  ports?: QuestionPorts,
) => Promise<DoctorReport>;
/** null: the prompt is not this recorder's input. A question has one answer record whose identity derives from the question, so a concurrent second answer conflicts in the store instead of appending. */
export type PromptRecorder = (
  input: import("./contracts.mjs").HookInput,
  ctx: import("./contracts.mjs").ReadyHookContext,
) => Promise<import("./contracts.mjs").HookResult | null>;
/** Stop of the turn whose submission recorded aside.asked appends aside.answered; it never blocks. */
export type RecordAsideAnswer = (
  input: import("./contracts.mjs").HookInput,
  ctx: import("./contracts.mjs").ReadyHookContext,
) => Promise<import("./contracts.mjs").HookResult>;
/** Over measured records only (neither synthetic nor estimated); `missing` counts records without the field. `excluded` is a wait already counted on the intent.approved that shares this parent. */
export type MeasureSummary = {
  n: number;
  sum: number;
  min: number;
  max: number;
  missing: number;
  examples: string[];
  excluded?: number;
};
/** `estimated`: migrated records whose time or duration was derived; like synthetic ones, excluded from measures. */
export type TypeSummary = {
  count: number;
  synthetic: number;
  estimated: number;
  measures: Record<string, MeasureSummary>;
};
export type AuditReport = {
  intent: string;
  path: string;
  /** Readable records, synthetic included. */
  events: number;
  invalid: number[];
  duplicates: string[];
  types: Record<string, TypeSummary>;
  /** Start records of a pair without any recorded end, by type. */
  unpaired: Record<string, string[]>;
  /** Readable legacy.* records, kept out of measures. */
  legacy: number;
  /** Gate answers whose wait is already on an intent.approved. */
  shared_waits: string[];
};
export type ReportPorts = { intent: string | null };
/** Measured values only; nothing is estimated or filled in. */
export type RunReport = (
  files: FileStore,
  environment: DoctorEnvironment,
  git: GitStatus,
  ports?: ReportPorts,
) => Promise<DoctorReport & { report?: AuditReport }>;
export type StatuslineMain = (
  files: FileStore,
  intent: string | null,
  harness: import("./contracts.mjs").Harness,
) => Promise<string>;
export type StatuslineOptions = {
  environment?: DoctorEnvironment;
  files?: FileStore;
  intent?: string | null;
  stdout?: { write: (text: string) => unknown };
  finish?: (code: 0) => void;
};

/** FileStore awaits both synchronous native operations and asynchronous test ports. The native CLI driver blocks only its own process; it does not cache metadata. Every update retains validation, owned locking, fsync, close, and atomic rename. */
export type FileOperationResult<T> = T | Promise<T>;
export type FileWriteHandle = {
  writeFile: (
    data: string | Uint8Array,
    encoding: "utf8",
  ) => FileOperationResult<void>;
  sync: () => FileOperationResult<void>;
  close: () => FileOperationResult<void>;
};
export type FileOperations = {
  realpath: (path: string) => FileOperationResult<string>;
  stat: (path: string) => FileOperationResult<import("node:fs").Stats>;
  lstat: (path: string) => FileOperationResult<import("node:fs").Stats>;
  readFile: (path: string) => FileOperationResult<Buffer>;
  mkdir: (path: string, options?: { recursive: true }) => unknown;
  open: (
    path: string,
    flags: "wx",
    mode: number,
  ) => FileOperationResult<FileWriteHandle>;
  rename: (from: string, to: string) => unknown;
  rm: (path: string, options: { force: true }) => unknown;
  rmdir: (path: string) => unknown;
  /** Only FileStore.list needs it. */
  readdir?: (path: string) => FileOperationResult<string[]>;
};

/** Synchronous descriptor ports for the hook's own stdin and stderr; EAGAIN is retried. */
export type DescriptorRead = (
  descriptor: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: null,
) => number;
export type DescriptorWrite = (
  descriptor: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
) => number;
