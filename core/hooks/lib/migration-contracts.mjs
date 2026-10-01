/**
 * v2 record migration contracts (docs/development/migrate.md). Types only; no I/O or parsing here.
 * The command reads and copies mechanically, the model writes the destination artifacts, and only a
 * person's `vouch migrate approve` records migration.completed. Nothing here approves or confirms.
 * @typedef {import('./contracts.mjs').Stage} Stage
 * @typedef {import('./contracts.mjs').AuditEvent} AuditEvent
 * @typedef {'completed'|'active'|'pending'|'skipped'} CheckboxState
 * @typedef {'completed'|'active'|'pending'|'skipped'|'absent'} StageProgress `absent`: no v2 stage of the record maps here.
 * @typedef {{slug:string,unit:string|null,mark:string,state:CheckboxState,line:number}} StateRow
 * One `- [<mark>] <slug>` line; `unit` is the `Per unit:` heading above it, null for `[unit-name]` or none.
 * @typedef {{fields:Record<string,string>,rows:StateRow[],problems:string[]}} V2State
 * `fields`: the `- **Name**: value` lines; `problems`: why the checkboxes cannot be classified.
 * @typedef {(text:string|null)=>V2State} ReadState
 * @typedef {{state:StageProgress,stages:string[]}} StageObservation `stages`: `slug [mark]` in file order.
 * @typedef {(rows:StateRow[])=>Record<Stage,StageObservation>} ObserveProgress
 * @typedef {object} AuditBlock One `---`-separated block of a v2 shard.
 * @property {string} path Project-relative shard path.
 * @property {number} index 1-based block number in the shard.
 * @property {number} line 1-based line of the block's first nonblank line.
 * @property {string} raw The block text without surrounding blank lines, never rewritten.
 * @property {string|null} ts A valid UTC timestamp of the block itself.
 * @property {string|null} name The `**Event**:` value.
 * @property {Record<string,string>} fields The first value of each `**Name**: value` line.
 * @typedef {(path:string,text:string)=>AuditBlock[]} ReadShard
 * @typedef {object} ConvertedAudit
 * @property {AuditEvent[]} events In merged time order.
 * @property {{name:string,count:number,to:string,converted:number,legacy:number,estimated:number}[]} types
 * @property {{id:string,name:string,ts:string,source_path:string}[]} decisions Human decision candidates.
 * @property {string[]} problems Shards without any valid timestamp.
 * @typedef {(blocks:AuditBlock[],intent:string,progress:Record<Stage,StageObservation>)=>ConvertedAudit} ConvertAudit
 * @typedef {object} MigratedFile
 * @property {string} path Project-relative source path.
 * @property {string} origin Path below the record, or below the space for codekb / memory.
 * @property {number} bytes
 * @property {string} sha256
 * @property {string} archive Project-relative archive copy.
 * @property {string[]} to Destinations; empty means archive only.
 * @property {string} [note] Why `to` is empty.
 * @typedef {{repo:string,files:number,scanned:string|null,commit:string|null,verifiable:boolean}} CodekbObservation
 * @typedef {{path:string,present:boolean,status:string|null}} ArtifactPresence
 * @typedef {object} MigrationPayload
 * @property {string} source Project-relative record directory.
 * @property {string} intent
 * @property {'ja'|'en'} language
 * @property {MigratedFile[]} files Every source file, in code-unit order of `path`.
 * @property {Record<Stage,StageObservation>} progress
 * @property {string[]} units
 * @property {{blocks:number,converted:number,legacy:number,estimated:number,types:ConvertedAudit['types']}} audit
 * @property {ConvertedAudit['decisions']} decisions
 * @property {string|null} affirmation Where the affirmation evidence was found.
 * @property {CodekbObservation[]} codekb
 * @property {ArtifactPresence[]} artifacts Expected destination artifacts and their raw frontmatter status.
 * @property {{path:string,sha256:string|null}} brief The current migration.md digest, null when absent.
 * @property {{archived:number,unchanged:number,audit:'appended'|'duplicate'|'none',brief:'written'|'unchanged'}} [writes]
 * @typedef {import('./runtime-contracts.mjs').DoctorReport & {migration?:MigrationPayload}} MigrationReport
 * @typedef {{args:string[],now:() => string}} MigratePorts
 * @typedef {(files:import('./runtime-contracts.mjs').FileStore,environment:import('./runtime-contracts.mjs').DoctorEnvironment,git:import('./runtime-contracts.mjs').GitStatus,ports?:MigratePorts)=>Promise<MigrationReport>} RunMigrate
 * `plan <record> [<intent>]` reads only; `apply` also writes the archive, the audit and migration.md when
 * no target conflicts, then verifies the archive against the unchanged source.
 * @typedef {(payload:MigrationPayload)=>string} RenderBrief Deterministic: the same payload, the same bytes.
 */

export {};
