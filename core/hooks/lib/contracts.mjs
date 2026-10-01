/**
 * Contracts only. No I/O, parsing, emission, or authorization is implemented here.
 * JSON Schema is the wire contract; these types describe values after validation.
 * Numeric bounds, cross-record references and filesystem containment need runtime checks.
 * @typedef {'intent'|'design'|'build'|'verify'} Stage
 * @typedef {'L'|'M'|'H'} Risk
 * @typedef {'claude'|'codex'} Harness
 * @typedef {'model'|'hook'|'human'|'reviewer'} Actor
 * @typedef {'contract'|'dod'|'freshness'|'citation'|'format'} Check
 * @typedef {{in:number,out:number,cache?:number}} Tokens
 * @typedef {null|boolean|number|string|unknown[]|JsonObject} JsonValue
 * @typedef {{[key:string]:unknown}} JsonObject
 */

/**
 * A missing measurement means unavailable; it never means zero.
 * `synthetic` labels authored schema examples and cannot authenticate a real event.
 * @typedef {object} AuditBase
 * @property {string} id Deterministically derived from session and input identity.
 * @property {1} v
 * @property {string} ts UTC timestamp.
 * @property {Actor} actor
 * @property {string} [intent]
 * @property {Stage} [stage]
 * @property {string} [unit]
 * @property {string} [session]
 * @property {string} [parent] Matching start/request ID; never evidence of human approval alone.
 * @property {number} [duration_ms]
 * @property {number} [wait_ms]
 * @property {true} [synthetic]
 * @property {string} [original_type] Migrated records only: the v2 event name, or UNTYPED for a block without one.
 * @property {string} [raw] Migrated records only: the original block text, never rewritten.
 * @property {string} [source_path] Migrated records only: the project-relative v2 file and first line (`path#Ln`).
 * @property {true} [estimated] A time or duration derived from neighbouring records, never a measurement.
 */

/** @typedef {AuditBase & ({harness:'claude',tokens?:Tokens}|{harness?:Harness,tokens?:never})} AuditCommon */
/**
 * Optional on historical audit records, mandatory for evidence comparison.
 * Digests and IDs bind data; they do not prove human consent or trusted provenance.
 * @typedef {{path:'intent.md',sha256:string}} IntentRevision
 * @typedef {{hook_event_name:'UserPromptSubmit',field:'prompt_id'|'turn_id',id:string,prompt_sha256:string}} Submission
 * @typedef {({harness:'claude',submission:Submission & {field:'prompt_id'}}|{harness:'codex',submission:Submission & {field:'turn_id'}}) & {session:string,revision:IntentRevision}} IntentApprovalEvidence
 * `content` digests the confirmed part only: an intent.md section or Unit row, or the normalized design.md,
 * one of its sections, or it without the other Units' rows.
 * @typedef {{path:'intent.md'|'design.md',sha256:string}} CheckpointContent
 * @typedef {({harness:'claude',submission:Submission & {field:'prompt_id'}}|{harness:'codex',submission:Submission & {field:'turn_id'}}) & {session:string,content:CheckpointContent}} CheckpointEvidence
 */
/** @typedef {AuditCommon & {type:'intent.created',intent:string,risk:Risk}} IntentCreated */
/** @typedef {AuditCommon & {type:'intent.approved',intent:string,actor:'human',source:'intent',parent:string,wait_ms:number} & ({revision?:never,submission?:never}|IntentApprovalEvidence)} IntentApproved */
/** @typedef {AuditCommon & {type:'intent.completed',intent:string,parent:string,duration_ms:number,ai_work_ms:number,human_wait_ms:number,human_review_ms:number}} IntentCompleted */
/** @typedef {AuditCommon & {type:'stage.started',intent:string,stage:Stage}} StageStarted */
/** @typedef {AuditCommon & {type:'stage.completed',intent:string,parent:string,duration_ms:number} & ({stage:'build',loop_iterations:number,tests:number}|{stage:Exclude<Stage,'build'>,loop_iterations?:number,tests?:number})} StageCompleted */
/** @typedef {AuditCommon & {type:'unit.started',intent:string,unit:string,risk:Risk}} UnitStarted */
/** @typedef {AuditCommon & {type:'unit.completed',intent:string,unit:string,risk:Risk,parent:string,duration_ms:number,files_changed:number,lines_changed:number}} UnitCompleted */
/** @typedef {AuditCommon & {type:'checkpoint.confirmed',intent:string,actor:'human'} & ({checkpoint:'acceptance'|'scope'|'units'|'design',section?:string}|{checkpoint:'design',unit:string}|{checkpoint:'unit',unit:string}|{checkpoint:'section',section:string}) & ({content?:never,submission?:never}|CheckpointEvidence)} CheckpointConfirmed */
/** @typedef {AuditCommon & {type:'gate.opened',intent:string,source:'intent'|'pr'} & ({revision?:never}|{revision:IntentRevision,source:'intent',actor:'hook',harness:Harness,session:string})} GateOpened */
/** @typedef {AuditCommon & {type:'gate.approved',intent:string,actor:'human',source:'intent'|'pr',parent:string,wait_ms:number}} GateApproved */
/** @typedef {AuditCommon & {type:'gate.rejected',intent:string,actor:'human',source:'intent'|'pr',parent:string,wait_ms:number,reason:string}} GateRejected */
/** `card` digests the decisions.md card without its answer section; an answer binds to that version.
 * @typedef {AuditCommon & {type:'question.asked',intent:string,question:string,options:number,card?:{path:'decisions.md',sha256:string}} & ({blocking:false,default:string}|{blocking:true,default?:string})} QuestionAsked */
/** @typedef {AuditCommon & {type:'question.answered',intent:string,actor:'human',question:string,choice:string,parent:string,wait_ms:number}} QuestionAnswered */
/** @typedef {AuditCommon & {type:'question.defaulted',intent:string,question:string,choice:string,parent:string,wait_ms:number}} QuestionDefaulted */
/** @typedef {AuditCommon & {type:'aside.asked',intent:string,question:string}} AsideAsked */
/** @typedef {AuditCommon & {type:'aside.answered',intent:string,question:string,parent:string,duration_ms:number,answer?:string}} AsideAnswered `answer`: the bounded final message of the asking turn when the harness supplied it. */
/** @typedef {{target:string,command:string,cwd:string,result:'pass'|'fail',duration_ms:number,exit_code?:number}} DodCommand `exit_code` is absent when the command did not run to an exit. */
/** @typedef {{sha256:string,generation?:string,head?:string}} KnowledgeObservation */
/** @typedef {AuditCommon & {knowledge?:KnowledgeObservation,type:'hook.check',actor:'hook',check:Check,result:'pass'|'fail',duration_ms:number,missing?:number,stale?:number} & ({commit?:never,clean?:never,commands?:never,output?:never}|{check:'dod',commit?:string,clean:boolean,commands:DodCommand[],output:{path:'build-log.md',sha256:string}})} HookCheck */
/** @typedef {AuditCommon & {knowledge?:KnowledgeObservation,type:'hook.denied',actor:'hook',check:Check,result:'fail',reason:string,duration_ms:number}} HookDenied */
/** @typedef {AuditCommon & {type:'review.requested',intent:string,iteration:number,harness:Harness}} ReviewRequested */
/** @typedef {AuditCommon & {type:'review.completed',intent:string,iteration:number,harness:Harness,findings:number,sabotage:{tried:number,caught:number},parent:string,duration_ms:number}} ReviewCompleted */
/** @typedef {AuditCommon & {knowledge?:KnowledgeObservation,type:'knowledge.refreshed',scope:'diff'|'full',duration_ms:number}} KnowledgeRefreshed */
/** @typedef {AuditCommon & {type:'session.started',session:string}} SessionStarted */
/** @typedef {AuditCommon & {type:'session.resumed',session:string,duration_ms:number}} SessionResumed */
/** @typedef {AuditCommon & {type:'session.compacted',session:string}} SessionCompacted */
/** @typedef {AuditCommon & {type:'session.ended',session:string,parent:string,duration_ms:number}} SessionEnded */
/** @typedef {AuditCommon & {type:'learn.recorded',intent:string,rules_added:number}} LearnRecorded */
/** `revision` binds the person's `vouch migrate approve` to the migration.md bytes it named.
 * @typedef {AuditCommon & {type:'migration.completed',files_migrated:number} & ({revision?:never,submission?:never}|{actor:'human',revision:{path:'migration.md',sha256:string},submission:Submission,harness:Harness,session:string})} MigrationCompleted */
/** @typedef {AuditCommon & {type:`legacy.${string}`,original_type:string,raw:string,source_path:string}} LegacyEvent */
/** @typedef {IntentCreated|IntentApproved|IntentCompleted|StageStarted|StageCompleted|UnitStarted|UnitCompleted|CheckpointConfirmed|GateOpened|GateApproved|GateRejected|QuestionAsked|QuestionAnswered|QuestionDefaulted|AsideAsked|AsideAnswered|HookCheck|HookDenied|ReviewRequested|ReviewCompleted|KnowledgeRefreshed|SessionStarted|SessionResumed|SessionCompacted|SessionEnded|LearnRecorded|MigrationCompleted|LegacyEvent} AuditEvent */
/**
 * find and list return detached records in file order. Mutating them cannot alter future reads or writes.
 * Each lookup and valid nonempty append rereads the file. Validation may reuse only an exactly
 * equal previously validated text snapshot, including the read under the write lock.
 * @typedef {{append:(events:AuditEvent[]) => Promise<'appended'|'duplicate'>,find?:(id:string) => Promise<AuditEvent|undefined>,list?:() => Promise<AuditEvent[]>}} AuditStore
 */

/**
 * Raw harness payload after structural validation. Unknown fields are accepted by
 * the schema and discarded by parseInput. `cwd` is untrusted input.
 * @typedef {object} HookInputBase
 * @property {string} session_id
 * @property {string} cwd
 * @property {string} [transcript_path]
 * @property {string} [model]
 * @property {string} [permission_mode]
 * @property {string} [prompt_id] Claude UserPromptSubmit identity, preserved from captured input.
 * @property {string} [turn_id]
 * @property {string} [tool_use_id]
 * @property {string} [agent_type]
 * @property {string} [agent_transcript_path]
 * @property {string} [last_assistant_message]
 */
/** @typedef {HookInputBase & ({hook_event_name:'SessionStart',source:string}|{hook_event_name:'UserPromptSubmit',prompt:string}|{hook_event_name:'PreToolUse',tool_name:string,tool_input:JsonObject}|{hook_event_name:'PostToolUse',tool_name:string,tool_input:JsonObject,tool_response:JsonValue}|{hook_event_name:'PreCompact',trigger:string}|{hook_event_name:'SubagentStop',agent_id:string,stop_hook_active?:boolean}|{hook_event_name:'Stop',stop_hook_active:boolean})} HookInput */

/**
 * Complete audit records, not raw stdin or a harness-specific stdout response.
 * `deny` requires a nonempty reason. io.run appends validated records, then reports
 * denial on stderr with exit 2.
 * `context` is plain text io.run writes to stdout after the append succeeds; harnesses add SessionStart
 * stdout to the model's context. It carries observations, never instructions or approvals.
 * `approve` asks io.run, after the append succeeds, to turn the configured Intent's draft of
 * that revision into approved; any other current text fails the run instead (docs/development/approval-boundary.md).
 * @typedef {{sha256:string}} ApproveTransition
 * @typedef {{decision:'allow',reason?:string,events?:AuditEvent[],context?:string}|{decision:'deny',reason:string,events?:AuditEvent[],approve?:ApproveTransition}} HookResult
 * @typedef {{exitCode:0,stdout:JsonValue,stderr:string}|{exitCode:2,stdout:JsonValue,stderr:string}} HookProcessResult
 */

/**
 * Dependencies are supplied by the wrapper, never trusted from stdin.
 * @typedef {object} HookContext
 * @property {string} projectRoot Trusted root; resolved paths still need containment checks.
 * @property {Harness} harness Selected by installation, not payload claims.
 * @property {string} [intent] Explicit installed scope, never derived from stdin.
 * @property {(path:string) => Promise<string|null>} [readText] io supplies contained UTF-8 artifact reads.
 * @property {AuditStore} [audit] io supplies the configured intent store. Session recording requires find();
 * approval and the build boundary also require list().
 * @property {string} generation Knowledge generation to compare with citations.
 * @property {() => string} now UTC time supplied by clock.mjs.
 * @property {(session:string,inputIdentity:string) => string} newId Deterministic event identity.
 * @typedef {HookContext & {readText:(path:string) => Promise<string|null>,locate:(path:string,from?:string) => Promise<import('./runtime-contracts.mjs').PathLocation>}} ReadyHookContext
 * io validates FileStore before invoking main. PreToolUse paths are classified by main through locate.
 * @typedef {(input:HookInput,ctx:ReadyHookContext) => HookResult|Promise<HookResult>} HookMain
 */

/**
 * Missing version on imported evidence is preserved, never guessed from `model`.
 * Only nonsynthetic records with a known harness version qualify for TEST-7.
 * @typedef {object} HarnessFixture
 * @property {Harness} harness
 * @property {string|null} version
 * @property {boolean} synthetic
 * @property {'imported'|'captured'|'synthetic'} provenance
 * @property {{path:string,commit:string,key:string}} [source]
 * @property {HookInput} payload
 */

export {};
