/**
 * Manual CLI exercises use disposable directories, never the user's configuration.
 * @typedef {object} NativeScope
 * @property {string} home Absolute isolated CODEX_HOME.
 * @property {string} project Absolute isolated project root.
 * @property {string} intent Explicit disposable Intent identifier.
 *
 * @typedef {object} NativeSubmission
 * @property {'gate.opened'|'intent.approved'} event
 * @property {boolean} observed
 * @property {number|null} exitCode CLI exit code, not the hook exit code.
 * @property {boolean} terminatedByController Observation ended by the exercise.
 *
 * @typedef {object} ListedHook
 * @property {string} key
 * @property {string} eventName
 * @property {string} currentHash
 * @property {string} sourcePath
 * @property {string} source
 * @property {string} command
 *
 * Installed-registration exercises; expectations are in docs/development/harness-fixtures.md.
 * `no-root` is recorded without a verdict.
 * @typedef {'allow'|'open'|'invalid'|'corrupt'|'no-intent'|'no-root'} PropagationCase
 *
 * @typedef {object} PropagationObservation
 * @property {PropagationCase} case
 * @property {'claude'|'codex'} harness
 * @property {boolean} interactive
 * @property {number|null} exitCode CLI exit code; null when the exercise ended the CLI.
 * @property {number} promptRequests Provider conversation requests that carried the prompt.
 * @property {unknown[]} events Audit rows after the exercise.
 * @property {boolean} auditExists
 * @property {boolean} auditUnchanged Audit bytes equal what the exercise prepared.
 * @property {string} output CLI stdout and stderr, or the terminal log without escape sequences.
 *
 * Scripted tool requests against a copied registration; see docs/development/write-guard.md.
 * @typedef {'audit-file'|'audit-shell'|'registration'|'approve'|'link'|'draft'|'read'} GuardCase
 *
 * @typedef {object} GuardObservation
 * @property {GuardCase} case
 * @property {string} tool Tool the provider requested.
 * @property {string|null} reason First VOUCH-GUARD-* ID in the tool result returned to the model.
 * @property {string} result Tool result text returned to the model, shortened.
 * @property {boolean} changed The target bytes differ after the run.
 * @property {boolean} expected The target (or, for read, the result) holds the requested effect.
 *
 * @typedef {object} GuardRun
 * @property {'claude'|'codex'} harness
 * @property {string} cliVersion
 * @property {string} platform
 * @property {string} nodeVersion
 * @property {'guarded'|'control'} registration Control removes only PreToolUse from the copy.
 * @property {GuardObservation[]} observations
 * @property {{type:unknown,harness:unknown}[]} audit Audit records after the run.
 * @property {boolean} forged A scripted forged record reached the audit.
 * @property {string[]} errors Expectation IDs the check reported.
 */
export {};
