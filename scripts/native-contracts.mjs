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
 */
export {};
