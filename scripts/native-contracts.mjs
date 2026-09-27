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
 */
export {};
