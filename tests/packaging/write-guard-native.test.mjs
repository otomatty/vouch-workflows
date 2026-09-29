import { test } from "node:test";
import {
  guardCases,
  verifyGuard,
} from "../../scripts/lib/write-guard-native.mjs";
import observed from "../fixtures/native/write-guard-linux.json" with {
  type: "json",
};

/** @typedef {import('../../scripts/native-contracts.mjs').GuardRun} GuardRun */
/** @typedef {import('../../scripts/native-contracts.mjs').GuardObservation} GuardObservation */

test("saved Linux write-guard runs meet the guarded and control expectations", (t) => {
  const runs = /** @type {GuardRun[]} */ (observed.runs);
  t.plan(5 + runs.length * 2);
  t.assert.deepEqual(
    [
      observed.kind,
      observed.scripted,
      observed.humanApproval,
      observed.modelEvaluation,
    ],
    ["native-cli-observation", true, false, false],
  );
  t.assert.deepEqual(
    runs.map((run) => `${run.harness}:${run.registration}`).sort(),
    ["claude:control", "claude:guarded", "codex:control", "codex:guarded"],
    "each harness runs with and without the guard registration",
  );
  t.assert.equal(
    runs.every((run) => run.platform === "linux"),
    true,
  );
  t.assert.deepEqual(
    runs.flatMap((run) =>
      verifyGuard(run).map(
        (error) => `${run.harness}:${run.registration}:${error}`,
      ),
    ),
    [],
  );
  t.assert.deepEqual(
    runs.flatMap((run) => run.errors),
    [],
    "the check reported the same result when it ran",
  );
  for (const run of runs) {
    t.assert.deepEqual(
      run.observations.map((item) => item.case),
      guardCases(),
    );
    t.assert.equal(
      run.observations
        .filter((item) => ["draft", "read"].includes(item.case))
        .every((item) => item.expected),
      true,
      `${run.harness}:${run.registration}: allowed requests take effect`,
    );
  }
});

/** @type {GuardObservation[]} */
const observations = guardCases().map((kase) => ({
  case: kase,
  tool: "Write",
  reason:
    kase === "registration"
      ? "VOUCH-GUARD-INSTALLATION"
      : kase === "approve"
        ? "VOUCH-GUARD-APPROVED"
        : ["draft", "read"].includes(kase)
          ? null
          : "VOUCH-GUARD-AUDIT",
  result: "",
  changed: ["draft"].includes(kase),
  expected: ["draft", "read"].includes(kase),
}));
/** @type {GuardRun} */
const guarded = {
  harness: "claude",
  cliVersion: "test",
  platform: "linux",
  nodeVersion: "test",
  registration: "guarded",
  observations,
  audit: [{ type: "session.started", harness: "claude" }],
  forged: false,
  errors: [],
};
/** @type {GuardRun} */
const control = {
  ...guarded,
  registration: "control",
  observations: observations.map((item) => ({
    ...item,
    reason: null,
    changed: true,
    expected: item.case !== "registration",
  })),
  forged: true,
};

/** @param {GuardRun} run @param {string} kase @param {Partial<GuardObservation>} change */
const alter = (run, kase, change) => ({
  ...run,
  observations: run.observations.map((item) =>
    item.case === kase ? { ...item, ...change } : item,
  ),
});

test("write-guard verification names each broken expectation", (t) => {
  /** @type {[GuardRun,string[]][]} */
  const cases = [
    [guarded, []],
    [
      alter(guarded, "audit-file", { reason: null }),
      ["audit-file:GUARD-REASON"],
    ],
    [
      alter(guarded, "link", { reason: "VOUCH-GUARD-LINK" }),
      ["link:GUARD-REASON"],
    ],
    [alter(guarded, "approve", { changed: true }), ["approve:GUARD-EFFECT"]],
    [
      alter(guarded, "draft", { reason: "VOUCH-GUARD-APPROVED" }),
      ["draft:GUARD-REASON"],
    ],
    [alter(guarded, "read", { expected: false }), ["read:GUARD-EFFECT"]],
    [{ ...guarded, forged: true }, ["GUARD-AUDIT"]],
    [
      { ...guarded, audit: [{ type: "session.started", harness: "codex" }] },
      ["GUARD-AUDIT"],
    ],
    [{ ...guarded, audit: [] }, ["GUARD-AUDIT"]],
    [{ ...guarded, observations: observations.slice(1) }, ["GUARD-CASES"]],
    [control, []],
    [alter(control, "registration", { expected: false }), []],
    [alter(control, "approve", { expected: false }), ["approve:GUARD-EFFECT"]],
    [
      alter(control, "audit-shell", { reason: "VOUCH-GUARD-AUDIT" }),
      ["audit-shell:GUARD-REASON"],
    ],
  ];
  t.plan(cases.length);
  for (const [run, expected] of cases)
    t.assert.deepEqual(verifyGuard(run), expected);
});
