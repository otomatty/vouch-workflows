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
 */

/** @typedef {AuditBase & ({harness:'claude',tokens?:Tokens}|{harness?:Harness,tokens?:never})} AuditCommon */
/** @typedef {AuditCommon & {type:'intent.created',intent:string,risk:Risk}} IntentCreated */
/** @typedef {AuditCommon & {type:'intent.approved',intent:string,actor:'human',source:'intent',parent:string,wait_ms:number}} IntentApproved */
/** @typedef {AuditCommon & {type:'intent.completed',intent:string,parent:string,duration_ms:number,ai_work_ms:number,human_wait_ms:number,human_review_ms:number}} IntentCompleted */
/** @typedef {AuditCommon & {type:'stage.started',intent:string,stage:Stage}} StageStarted */
/** @typedef {AuditCommon & {type:'stage.completed',intent:string,parent:string,duration_ms:number} & ({stage:'build',loop_iterations:number,tests:number}|{stage:Exclude<Stage,'build'>,loop_iterations?:number,tests?:number})} StageCompleted */
/** @typedef {AuditCommon & {type:'unit.started',intent:string,unit:string,risk:Risk}} UnitStarted */
/** @typedef {AuditCommon & {type:'unit.completed',intent:string,unit:string,risk:Risk,parent:string,duration_ms:number,files_changed:number,lines_changed:number}} UnitCompleted */
/** @typedef {AuditCommon & {type:'checkpoint.confirmed',intent:string,actor:'human'} & ({checkpoint:'acceptance'|'scope'|'units'|'design',section?:string}|{checkpoint:'unit',unit:string}|{checkpoint:'section',section:string})} CheckpointConfirmed */
/** @typedef {AuditCommon & {type:'gate.opened',intent:string,source:'intent'|'pr'}} GateOpened */
/** @typedef {AuditCommon & {type:'gate.approved',intent:string,actor:'human',source:'intent'|'pr',parent:string,wait_ms:number}} GateApproved */
/** @typedef {AuditCommon & {type:'gate.rejected',intent:string,actor:'human',source:'intent'|'pr',parent:string,wait_ms:number,reason:string}} GateRejected */
/** @typedef {AuditCommon & {type:'question.asked',intent:string,question:string,options:number} & ({blocking:false,default:string}|{blocking:true,default?:string})} QuestionAsked */
/** @typedef {AuditCommon & {type:'question.answered',intent:string,actor:'human',question:string,choice:string,parent:string,wait_ms:number}} QuestionAnswered */
/** @typedef {AuditCommon & {type:'question.defaulted',intent:string,question:string,choice:string,parent:string,wait_ms:number}} QuestionDefaulted */
/** @typedef {AuditCommon & {type:'aside.asked',intent:string,question:string}} AsideAsked */
/** @typedef {AuditCommon & {type:'aside.answered',intent:string,question:string,parent:string,duration_ms:number}} AsideAnswered */
/** @typedef {AuditCommon & {type:'hook.check',actor:'hook',check:Check,result:'pass'|'fail',duration_ms:number,missing?:number,stale?:number}} HookCheck */
/** @typedef {AuditCommon & {type:'hook.denied',actor:'hook',check:Check,result:'fail',reason:string,duration_ms:number}} HookDenied */
/** @typedef {AuditCommon & {type:'review.requested',intent:string,iteration:number,harness:Harness}} ReviewRequested */
/** @typedef {AuditCommon & {type:'review.completed',intent:string,iteration:number,harness:Harness,findings:number,sabotage:{tried:number,caught:number},parent:string,duration_ms:number}} ReviewCompleted */
/** @typedef {AuditCommon & {type:'knowledge.refreshed',scope:'diff'|'full',duration_ms:number}} KnowledgeRefreshed */
/** @typedef {AuditCommon & {type:'session.started',session:string}} SessionStarted */
/** @typedef {AuditCommon & {type:'session.resumed',session:string,duration_ms:number}} SessionResumed */
/** @typedef {AuditCommon & {type:'session.compacted',session:string}} SessionCompacted */
/** @typedef {AuditCommon & {type:'session.ended',session:string,parent:string,duration_ms:number}} SessionEnded */
/** @typedef {AuditCommon & {type:'learn.recorded',intent:string,rules_added:number}} LearnRecorded */
/** @typedef {AuditCommon & {type:'migration.completed',files_migrated:number}} MigrationCompleted */
/** @typedef {AuditCommon & {type:`legacy.${string}`,original_type:string,raw:string,source_path:string}} LegacyEvent */
/** @typedef {IntentCreated|IntentApproved|IntentCompleted|StageStarted|StageCompleted|UnitStarted|UnitCompleted|CheckpointConfirmed|GateOpened|GateApproved|GateRejected|QuestionAsked|QuestionAnswered|QuestionDefaulted|AsideAsked|AsideAnswered|HookCheck|HookDenied|ReviewRequested|ReviewCompleted|KnowledgeRefreshed|SessionStarted|SessionResumed|SessionCompacted|SessionEnded|LearnRecorded|MigrationCompleted|LegacyEvent} AuditEvent */
/**
 * find returns a detached record. Mutating it cannot alter future reads or writes.
 * Each lookup and valid nonempty append rereads the file. Validation may reuse only an exactly
 * equal previously validated text snapshot, including the read under the write lock.
 * @typedef {{append:(events:AuditEvent[]) => Promise<'appended'|'duplicate'>,find?:(id:string) => Promise<AuditEvent|undefined>}} AuditStore
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
 * denial on stderr with exit 2. Harness-specific stdout adapters are separate.
 * @typedef {{decision:'allow',reason?:string,events?:AuditEvent[]}|{decision:'deny',reason:string,events?:AuditEvent[]}} HookResult
 * @typedef {{exitCode:0,stdout:JsonValue,stderr:string}|{exitCode:2,stdout:JsonValue,stderr:string}} HookProcessResult
 */

/**
 * Dependencies are supplied by the wrapper, never trusted from stdin.
 * @typedef {object} HookContext
 * @property {string} projectRoot Trusted root; resolved paths still need containment checks.
 * @property {Harness} harness Selected by installation, not payload claims.
 * @property {string} [intent] Explicit installed scope, never derived from stdin.
 * @property {AuditStore} [audit] io supplies the configured intent store. Session recording requires find().
 * @property {string} generation Knowledge generation to compare with citations.
 * @property {() => string} now UTC time supplied by clock.mjs.
 * @property {(session:string,inputIdentity:string) => string} newId Deterministic event identity.
 * @typedef {(input:HookInput,ctx:HookContext) => HookResult|Promise<HookResult>} HookMain
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
