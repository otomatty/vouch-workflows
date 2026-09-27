/**
 * Runtime boundary contracts. Paths and audit contents remain untrusted until checked.
 * @typedef {import('./contracts.mjs').AuditEvent} AuditEvent
 * @typedef {import('./contracts.mjs').HookContext} HookContext
 * @typedef {{now:() => string,newId:(session:string,identity:string) => string}} Clock
 * @typedef {(before:string|null) => string|null} TextUpdate
 * @typedef {object} FileStore
 * @property {(path:string) => Promise<string>} resolvePath Reject escapes, links and nonregular files.
 * @property {(path:string) => Promise<string|null>} readText Return null only for a missing file.
 * @property {(path:string,update:TextUpdate) => Promise<boolean>} updateText Serialize with a lock; replace atomically.
 * @property {(path:string,text:string) => Promise<boolean>} writeText Write through updateText.
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
