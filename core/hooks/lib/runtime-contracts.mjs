/**
 * Runtime boundary contracts. Paths and audit contents remain untrusted until checked.
 * @typedef {import('./contracts.mjs').AuditEvent} AuditEvent
 * @typedef {import('./contracts.mjs').HookContext} HookContext
 * @typedef {{now:() => string,newId:(session:string,identity:string) => string}} Clock
 * @typedef {(before:string|null) => string|null} TextUpdate
 * @typedef {object} FileStore
 * @property {(path:string) => Promise<string>} resolvePath Return the canonical-root target. An absolute
 * spelling through an alias of the root directory maps to it; escapes, links below the root and
 * nonregular files are rejected.
 * @property {(path:string) => Promise<string|null>} readText Return null only for a missing file.
 * @property {(path:string,update:TextUpdate) => Promise<boolean>} updateText Serialize with a lock; replace atomically.
 * @property {(path:string,text:string) => Promise<boolean>} writeText Write through updateText.
 * @property {(path:string,from?:string) => Promise<PathLocation>} locate Classify without trusting the spelling:
 * resolve against `from` (default: the root) with the platform's separators, map the deepest existing ancestor to its real path and append
 * the rest. Outside, linked and missing paths are results, not errors; a component that cannot be looked
 * up for any reason (denied, looping, too long) counts as missing, so a single word never fails the guard open.
 *
 * Where a spelled path lands after links, junctions, root aliases and 8.3 names are followed.
 * @typedef {object} PathLocation
 * @property {string|null} inside Canonical path below the canonical root, "/"-separated; "" is the root; null outside.
 * @property {boolean} contains The canonical path is the root or one of its ancestors.
 * @property {'file'|'directory'|'missing'|'other'|'unresolved'} kind After following links; unresolved is a dangling or
 * looping link, or a target that could not be examined after it was found.
 * @property {number} links Hard link count of an existing regular file; 0 otherwise.
 * @typedef {import('./contracts.mjs').AuditStore} AuditStore
 * @typedef {object} RuntimeOptions
 * @property {HookContext} [context] Trusted installation configuration. Otherwise use env.mjs.
 * @property {AsyncIterable<Uint8Array|string>} [stdin]
 * @property {{write:(text:string) => unknown}} [stdout]
 * @property {{write:(text:string) => unknown}} [stderr]
 * @property {(code:0|2) => void} [finish]
 * @property {FileStore} [files]
 * @property {AuditStore} [audit] Required when main returns events; never inferred from stdin.
 */

export {};

/**
 * Manual distribution diagnostic, separate from the stdin hook protocol.
 * No configuration repair, audit writes, or harness trust claims.
 * @typedef {{projectRoot:string,installationRoot:string,nodeVersion:string}} DoctorEnvironment
 * @typedef {{id:string,ok:boolean,detail:string}} DoctorCheck
 * @typedef {{v:1,ok:boolean,checks:DoctorCheck[]}} DoctorReport
 * @typedef {{ok:boolean,detail:string}} GitStatus
 * @typedef {(files:FileStore,environment:DoctorEnvironment,git:GitStatus)=>Promise<DoctorReport>} DoctorMain
 * @typedef {object} DoctorOptions
 * @property {DoctorEnvironment} [environment]
 * @property {FileStore} [files]
 * @property {() => GitStatus} [git]
 * @property {{write:(text:string)=>unknown}} [stdout]
 * @property {(code:0|2)=>void} [finish]
 */

/**
 * Pure evidence comparison, never an authorization decision or event producer.
 * Caller supplies the separately observed, validated input and installed scope.
 * A match also occurs for synthetic data; provenance and consent need future hooks.
 * @typedef {{status:'draft'|'approved',revision:import('./contracts.mjs').IntentRevision}} IntentSnapshot
 * @typedef {(text:string)=>IntentSnapshot|null} SnapshotIntent
 * @typedef {(input:import('./contracts.mjs').HookInput,harness:import('./contracts.mjs').Harness)=>import('./contracts.mjs').Submission|null} IdentifySubmission
 * @typedef {object} ApprovalComparisonInput
 * @property {unknown} gate
 * @property {unknown} approval
 * @property {import('./contracts.mjs').HookInput} input
 * @property {import('./contracts.mjs').Harness} harness
 * @property {string} intent
 * @property {string} text
 * @typedef {'invalid-record'|'missing-evidence'|'scope'|'parent'|'revision'|'submission'|'wait'} ApprovalMismatch
 * @typedef {{matches:true}|{matches:false,reason:ApprovalMismatch}} ApprovalComparison
 * @typedef {(value:ApprovalComparisonInput)=>ApprovalComparison} CompareIntentApprovalEvidence
 * @typedef {(start:string,end:string)=>number|null} ElapsedMilliseconds
 */

/**
 * Explicit operator inputs only. No inference of consent from ordinary text.
 * @typedef {{kind:'open'}|{kind:'approve',gate:string}|{kind:'confirm',target:CheckpointTarget}|{kind:'invalid'}|null} IntentReviewCommand
 * @typedef {(prompt:string)=>IntentReviewCommand} ParseIntentReviewCommand
 * @typedef {(input:import('./contracts.mjs').HookInput,ctx:import('./contracts.mjs').ReadyHookContext)=>Promise<import('./contracts.mjs').HookResult>} ReviewIntent
 * Records explicit review, checkpoint and approval inputs; asks io to apply approval only for an
 * approval input whose own record matches it and when every required checkpoint matches the current texts.
 */

/**
 * Approval boundary (docs/development/approval-boundary.md). Pure functions over texts the caller
 * read and validated audit records; they never read files, record events or trust actor claims.
 * @typedef {'acceptance'|'scope'|'units'|'design'} TopicCheckpoint
 * @typedef {{checkpoint:TopicCheckpoint}|{checkpoint:'unit',unit:string}|{checkpoint:'section',section:string}} CheckpointTarget
 * @typedef {'topic'|'unit'|'section'} CheckpointMode
 * @typedef {{id:string,risk:import('./contracts.mjs').Risk,design:boolean}} PlanUnit `design`: declared required.
 * @typedef {{units:PlanUnit[],risk:import('./contracts.mjs').Risk,design:boolean}} Plan `risk`: highest Unit;
 * `design`: an H Unit or a declared requirement.
 * @typedef {{plan:Plan}|{error:string}} PlanReading
 * @typedef {(text:string)=>PlanReading} ReadPlan The first table of the plan section, in registry grammar.
 * @typedef {(text:string|null)=>CheckpointMode|null} ReadCheckpointMode A missing rules.md (null) is the
 * workflow default; unreadable, duplicate or unknown settings are null, never the default.
 * @typedef {(mode:CheckpointMode,plan:Plan)=>CheckpointTarget[]} RequiredCheckpoints
 * @typedef {{intent:string,design:string|null}} ArtifactTexts
 * @typedef {(target:CheckpointTarget,texts:ArtifactTexts)=>import('./contracts.mjs').CheckpointContent|null} CheckpointContentOf
 * Digest of the exact confirmed bytes; null when the target is absent or not unique.
 * @typedef {(target:CheckpointTarget)=>string} DescribeTarget "acceptance", "unit U1", "section plan".
 * @typedef {(session:string,identity:string)=>string} NewId
 * @typedef {object} CheckpointQuery
 * @property {CheckpointTarget[]} required
 * @property {AuditEvent[]} events
 * @property {string} intent
 * @property {ArtifactTexts} texts
 * @property {NewId} newId
 * @typedef {(query:CheckpointQuery)=>CheckpointTarget[]} MissingCheckpoints Required targets without a
 * nonsynthetic, derived-identity confirmation of the current content, in required order.
 * @typedef {object} ApprovalQuery
 * @property {string} text Current intent.md, draft or approved.
 * @property {AuditEvent[]} events
 * @property {string} intent
 * @property {NewId} newId
 * @typedef {(query:ApprovalQuery)=>import('./contracts.mjs').IntentApproved|null} FindApproval The first
 * approval of the text's revision whose derived identity, parent gate, scope and wait all match.
 * @typedef {(text:string,sha256:string)=>string|null} ApprovedText The approved text of a draft or approved
 * document of that revision, with only the status value changed; null for any other text.
 * @typedef {(input:import('./contracts.mjs').HookInput,ctx:import('./contracts.mjs').ReadyHookContext)=>Promise<import('./contracts.mjs').HookResult>} GuardBuild
 * PreToolUse file edits outside vouch/ or to the configured Intent's build and verify artifacts wait for
 * an approved plan with evidence; unreadable evidence denies.
 */

/**
 * PreToolUse write guard (docs/development/write-guard.md). Stateless: it never writes, locks or
 * records, and grants nothing from tool_input contents such as actor fields. A deny names the
 * first matching area; allow means only that no inspected route names a protected target.
 * @typedef {'audit'|'lock'|'installation'|'artifact'} GuardArea
 * @typedef {{area:GuardArea,ancestor:boolean}} GuardMatch `ancestor`: the path contains the area.
 * @typedef {object} GuardScope
 * @property {string[]|null} installation Normalized segments of the installation directory below the root, or null.
 * @property {string[]} installed Normalized protected entry names inside the installation directory.
 * @typedef {(segments:string[],scope:GuardScope)=>GuardMatch|null} ClassifySegments Segments are
 * root-relative; glob segments may match any name at their position.
 * @typedef {(segment:string)=>string} NormalizeSegment Lower case without trailing dots, spaces or `:stream`.
 * @typedef {(text:string)=>boolean} DeclaresApproved A superset of the approved texts snapshotIntent reads.
 * @typedef {{kind:'add'|'update'|'delete',path:string,to:string|null,added:string[]}} PatchOperation
 * @typedef {(text:string)=>PatchOperation[]} ParsePatch Marker lines anywhere; unknown text is ignored.
 * @typedef {object} ShellCommand One simple command; keywords and operators are not words.
 * @property {string[]} words Unquoted words, redirection targets and here-document text included.
 * @property {boolean[]} expands Per word: unquoted glob, `{` or `~`, or `$` outside single quotes.
 * @property {boolean} writes An output redirection to anything but /dev/null or a descriptor.
 * @property {number} depth Subshell nesting at the start of the command.
 * @typedef {{commands:ShellCommand[],dynamic:boolean}} ShellParse `dynamic`: substitutions decided at run time.
 * @typedef {(text:string)=>ShellParse} ParseShell POSIX-like words only; no expansion or execution.
 * @typedef {(command:ShellCommand,doctor:(word:string)=>boolean)=>boolean} ReadsOnly
 * @typedef {(word:string)=>string[]|null} ExpandBraces Bash brace expansion; an integer sequence keeps its
 * first value; null past 256 results.
 * @typedef {(text:string)=>string} Uncommented Drops `#` comments only while POSIX shells and PowerShell
 * read every earlier character alike.
 * @typedef {(input:import('./contracts.mjs').HookInput,ctx:import('./contracts.mjs').ReadyHookContext,entry:string)=>Promise<import('./contracts.mjs').HookResult>} GuardWrites
 * `entry` is the hook file itself, as a path or file URL; the installation directory is never taken from stdin.
 */

/**
 * Git operations and DoD evidence (docs/development/git-guard.md). Only the process port runs
 * programs; the other functions read texts and records the caller supplies.
 * @typedef {[status:string,path:string]} Change A `--name-status --no-renames` entry; paths are root-relative.
 * @typedef {{sha:string,subject:string,changes:Change[]}} Commit
 * @typedef {{status:number|null,stdout?:string|Buffer|null,stderr?:string|Buffer|null,error?:Error}} Spawned
 * @typedef {(file:string,args:string[],options:import('node:child_process').SpawnSyncOptions)=>Spawned} SpawnPort
 * @typedef {(file:string,args:string[],options:import('node:child_process').SpawnSyncOptions,execute?:SpawnPort)=>Promise<Spawned>} Spawn
 * Hidden window; a shell only when options ask for one; Git calls use runtime.json gitTimeoutMs.
 * @typedef {(...args:string[])=>Promise<string|null>} GitPort Stdout of a read-only Git command; null on failure.
 * @typedef {(cwd:string,execute?:SpawnPort)=>GitPort} ReadGit `--no-optional-locks` Git in `cwd`.
 * @typedef {(harness:import('./contracts.mjs').Harness,tool:string)=>boolean} IsShellTool
 * @typedef {(subject:string)=>{type:string,unit:string}|null} CommitType A registered `<type>(<Unit>): ` subject.
 * @typedef {(text:string)=>Change[]} ReadChanges Entries of `--name-status -z` output.
 * @typedef {(git:GitPort)=>Promise<Commit[]|null>} BranchHistory Non-merge commits of HEAD outside every
 * protected branch, oldest first; null when Git cannot list them.
 * @typedef {(sha:string,kind:'pass'|'fail')=>boolean} Proven
 * @typedef {(events:AuditEvent[],intent:string,newId:NewId)=>Proven} DodEvidence Nonsynthetic dod checks of
 * the Intent at a clean commit with a derived identity; `fail` needs a command that exited nonzero.
 * @typedef {(commit:{subject:string,changes:Change[]},earlier:Commit[],units:string[],proven:Proven)=>['type'|'unit'|'test'|'order',string]|null} CommitViolation
 * The first broken rule and its registry detail; `earlier` holds the branch commits before it, oldest first.
 * @typedef {(input:import('./contracts.mjs').HookInput,ctx:import('./contracts.mjs').ReadyHookContext,execute?:SpawnPort)=>Promise<import('./contracts.mjs').HookResult>} GuardGit
 * PreToolUse shell pushes to a protected branch deny; with a configured Intent, pushes and `-m`
 * commits in the project repository that break a commit rule deny, and unreadable evidence denies.
 * @typedef {{intent:string|null,now:() => string,execute?:SpawnPort}} DodPorts
 * @typedef {(files:FileStore,environment:DoctorEnvironment,git:GitStatus,ports?:DodPorts)=>Promise<DoctorReport>} RunDod
 * Runs the rules.md DoD for an approved plan, appends build-log.md, then one hook.check record.
 */

/**
 * FileStore awaits both synchronous native operations and asynchronous test ports.
 * The native CLI driver blocks only its own process; it does not cache metadata.
 * Every update retains validation, owned locking, fsync, close, and atomic rename.
 * @typedef {T|Promise<T>} FileOperationResult
 * @template T
 */
/**
 * @typedef {object} FileWriteHandle
 * @property {(text:string,encoding:'utf8') => FileOperationResult<void>} writeFile
 * @property {() => FileOperationResult<void>} sync
 * @property {() => FileOperationResult<void>} close
 * @typedef {object} FileOperations
 * @property {(path:string) => FileOperationResult<string>} realpath
 * @property {(path:string) => FileOperationResult<import('node:fs').Stats>} stat
 * @property {(path:string) => FileOperationResult<import('node:fs').Stats>} lstat
 * @property {(path:string) => FileOperationResult<Buffer>} readFile
 * @property {(path:string,options?:{recursive:true}) => unknown} mkdir
 * @property {(path:string,flags:'wx',mode:number) => FileOperationResult<FileWriteHandle>} open
 * @property {(from:string,to:string) => unknown} rename
 * @property {(path:string,options:{force:true}) => unknown} rm
 * @property {(path:string) => unknown} rmdir
 */

/**
 * Synchronous descriptor ports for the hook's own stdin and stderr; EAGAIN is retried.
 * @typedef {(descriptor:number,buffer:Uint8Array,offset:number,length:number,position:null) => number} DescriptorRead
 * @typedef {(descriptor:number,buffer:Uint8Array,offset:number,length:number) => number} DescriptorWrite
 */
