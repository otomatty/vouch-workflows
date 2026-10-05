import { test } from "node:test";
import {
  guardCases,
  verifyGuard,
} from "../../scripts/lib/write-guard-native.mjs";
import observed from "../fixtures/native/write-guard-linux.json" with {
  type: "json",
};

export type GuardRun = import("../../scripts/native-contracts.mjs").GuardRun;
export type GuardObservation =
  import("../../scripts/native-contracts.mjs").GuardObservation;

test("saved Linux write-guard runs meet the guarded and control expectations", (t) => {
  const runs = observed.runs as GuardRun[];
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

const observations: GuardObservation[] = guardCases().map((kase) => ({
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
const guarded: GuardRun = {
  harness: "claude",
  cliVersion: "test",
  platform: "linux",
  nodeVersion: "test",
  registration: "guarded",
  exitCode: 0,
  observations,
  audit: [{ type: "session.started", harness: "claude" }],
  forged: false,
  errors: [],
};
const control: GuardRun = {
  ...guarded,
  registration: "control",
  observations: observations.map((item) => ({
    ...item,
    reason: null,
    changed: true,
    expected: !["link", "registration"].includes(item.case),
  })),
  forged: true,
};

const alter = (
  run: GuardRun,
  kase: string,
  change: Partial<GuardObservation>,
) => ({
  ...run,
  observations: run.observations.map((item) =>
    item.case === kase ? { ...item, ...change } : item,
  ),
});

test("write-guard verification names each broken expectation", (t) => {
  const cases: [GuardRun, string[]][] = [
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
    [alter(control, "link", { expected: true }), []],
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
