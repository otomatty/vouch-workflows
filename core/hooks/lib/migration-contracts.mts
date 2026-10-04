/** v2 record migration contracts (docs/development/migrate.md). Types only; no I/O or parsing here. The command reads and copies mechanically, the model writes the destination artifacts, and only a person's `vouch migrate approve` records migration.completed. Nothing here approves or confirms. */
export type Stage = import("./contracts.mjs").Stage;
export type AuditEvent = import("./contracts.mjs").AuditEvent;
export type CheckboxState = "completed" | "active" | "pending" | "skipped";
/** `absent`: no v2 stage of the record maps here. */
export type StageProgress =
  | "completed"
  | "active"
  | "pending"
  | "skipped"
  | "absent";
/** One `- [<mark>] <slug>` line; `unit` is the `Per unit:` heading above it, null for `[unit-name]` or none. */
export type StateRow = {
  slug: string;
  unit: string | null;
  mark: string;
  state: CheckboxState;
  line: number;
};
/** `fields`: the `- **Name**: value` lines; `problems`: why the checkboxes cannot be classified. */
export type V2State = {
  fields: Record<string, string>;
  rows: StateRow[];
  problems: string[];
};
export type ReadState = (text: string | null) => V2State;
/** `stages`: `slug [mark]` in file order. */
export type StageObservation = { state: StageProgress; stages: string[] };
export type ObserveProgress = (
  rows: StateRow[],
) => Record<Stage, StageObservation>;
/** One `---`-separated block of a v2 shard. */
export type AuditBlock = {
  /** Project-relative shard path. */
  path: string;
  /** 1-based block number in the shard. */
  index: number;
  /** 1-based line of the block's first nonblank line. */
  line: number;
  /** The block text without surrounding blank lines, never rewritten. */
  raw: string;
  /** A valid UTC timestamp of the block itself. */
  ts: string | null;
  /** The `**Event**:` value. */
  name: string | null;
  /** The first value of each `**Name**: value` line. */
  fields: Record<string, string>;
};
export type ReadShard = (path: string, text: string) => AuditBlock[];
export type ConvertedAudit = {
  /** In merged time order. */
  events: AuditEvent[];
  types: {
    name: string;
    count: number;
    to: string;
    converted: number;
    legacy: number;
    estimated: number;
  }[];
  /** Human decision candidates. */
  decisions: { id: string; name: string; ts: string; source_path: string }[];
  /** Shards without any valid timestamp. */
  problems: string[];
};
export type ConvertAudit = (
  blocks: AuditBlock[],
  intent: string,
  progress: Record<Stage, StageObservation>,
) => ConvertedAudit;
export type MigratedFile = {
  /** Project-relative source path. */
  path: string;
  /** Path below the record, or below the space for codekb / memory. */
  origin: string;
  bytes: number;
  sha256: string;
  /** Project-relative archive copy. */
  archive: string;
  /** Destinations; empty means archive only. */
  to: string[];
  /** Why `to` is empty. */
  note?: string;
};
export type CodekbObservation = {
  repo: string;
  files: number;
  scanned: string | null;
  commit: string | null;
  verifiable: boolean;
};
export type ArtifactPresence = {
  path: string;
  present: boolean;
  status: string | null;
};
export type MigrationPayload = {
  /** Project-relative record directory. */
  source: string;
  intent: string;
  language: "ja" | "en";
  /** Every source file, in code-unit order of `path`. */
  files: MigratedFile[];
  progress: Record<Stage, StageObservation>;
  units: string[];
  audit: {
    blocks: number;
    converted: number;
    legacy: number;
    estimated: number;
    types: ConvertedAudit["types"];
  };
  decisions: ConvertedAudit["decisions"];
  /** Where the affirmation evidence was found. */
  affirmation: string | null;
  codekb: CodekbObservation[];
  /** Expected destination artifacts and their raw frontmatter status. */
  artifacts: ArtifactPresence[];
  /** The current migration.md digest, null when absent. */
  brief: { path: string; sha256: string | null };
  writes?: {
    archived: number;
    unchanged: number;
    audit: "appended" | "duplicate" | "none";
    brief: "written" | "unchanged";
  };
};
export type MigrationReport = import("./runtime-contracts.mjs").DoctorReport & {
  migration?: MigrationPayload;
};
export type MigratePorts = { args: string[]; now: () => string };
/** `plan <record> [<intent>]` reads only; `apply` also writes the archive, the audit and migration.md when no target conflicts, then verifies the archive against the unchanged source. */
export type RunMigrate = (
  files: import("./runtime-contracts.mjs").FileStore,
  environment: import("./runtime-contracts.mjs").DoctorEnvironment,
  git: import("./runtime-contracts.mjs").GitStatus,
  ports?: MigratePorts,
) => Promise<MigrationReport>;
/** Deterministic: the same payload, the same bytes. */
export type RenderBrief = (payload: MigrationPayload) => string;
