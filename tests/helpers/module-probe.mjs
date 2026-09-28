// Test-only preload: record the builtin modules a hook process loaded before it exits.
// It uses the builtin fs object, so the probe itself loads no stream modules.
const log = process.env.VOUCH_TEST_MODULE_LOG;
if (!log) throw new Error("TEST: module log path required");
const { writeFileSync } = process.getBuiltinModule("node:fs");
const internals = /** @type {{moduleLoadList?:string[]}} */ (
  /** @type {unknown} */ (process)
);
process.on("exit", () =>
  writeFileSync(log, JSON.stringify(internals.moduleLoadList ?? null)),
);
