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
 * @typedef {{append:(events:AuditEvent[]) => Promise<'appended'|'duplicate'>}} AuditStore
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
