import { test } from "node:test";
import {
  approvalSteps,
  verifyApproval,
} from "../../scripts/lib/approval-native.mjs";
import observed from "../fixtures/native/approval-linux.json" with {
  type: "json",
};

export type ApprovalRun =
  import("../../scripts/native-contracts.mjs").ApprovalRun;

test("saved Linux approval runs meet the approval and build expectations", (t) => {
  const runs = observed.runs as ApprovalRun[];
  t.plan(5 + runs.length);
  t.assert.deepEqual(
    [
      observed.kind,
      observed.scripted,
      observed.humanApproval,
      observed.modelEvaluation,
    ],
    ["native-cli-observation", true, false, false],
  );
  t.assert.deepEqual(runs.map((run) => run.harness).sort(), [
    "claude",
    "codex",
  ]);
  t.assert.equal(
    runs.every((run) => run.platform === "linux"),
    true,
  );
  t.assert.deepEqual(
    runs.flatMap((run) =>
      verifyApproval(run).map((error) => `${run.harness}:${error}`),
    ),
    [],
  );
  t.assert.deepEqual(
    runs.flatMap((run) => run.errors),
    [],
    "the check reported the same result when it ran",
  );
  for (const run of runs)
    t.assert.deepEqual(
      run.observations.map((item) => item.step),
      approvalSteps(),
    );
});

test("the approval verification reports each broken expectation", (t) => {
  const run = structuredClone(
    observed.runs.find((item) => item.harness === "claude") ?? observed.runs[0],
  ) as ApprovalRun;
  const broken = (change: (copy: ApprovalRun) => void) => {
    const copy = structuredClone(run);
    change(copy);
    return verifyApproval(copy);
  };
  const at = (copy: ApprovalRun, step: string) =>
    copy.observations.find(
      (item) => item.step === step,
    ) as import("../../scripts/native-contracts.mjs").ApprovalObservation;
  t.plan(8);
  t.assert.deepEqual(verifyApproval(run), []);
  t.assert.deepEqual(
    broken((copy) => {
      at(copy, "write-before").written = true;
    }),
    ["write-before:APPROVAL-BUILD"],
  );
  t.assert.deepEqual(
    broken((copy) => {
      at(copy, "confirm-scope").promptRequests = 1;
    }),
    ["confirm-scope:APPROVAL-PROVIDER"],
  );
  t.assert.deepEqual(
    broken((copy) => {
      at(copy, "approve").status = "draft";
    }),
    ["approve:APPROVAL-STATUS"],
  );
  t.assert.deepEqual(
    broken((copy) => {
      at(copy, "review").reason = null;
    }),
    ["review:APPROVAL-REASON"],
  );
  t.assert.deepEqual(
    broken((copy) => {
      at(copy, "write-after").reason = "VOUCH-BUILD-UNAPPROVED";
    }),
    ["write-after:APPROVAL-BUILD"],
  );
  t.assert.deepEqual(
    broken((copy) => {
      copy.audit = copy.audit.map((row) => ({ ...row, synthetic: true }));
      copy.revisionKept = false;
    }),
    ["APPROVAL-AUDIT", "APPROVAL-REVISION"],
  );
  t.assert.deepEqual(
    broken((copy) => {
      copy.observations.reverse();
    }).includes("APPROVAL-STEPS"),
    true,
  );
});
