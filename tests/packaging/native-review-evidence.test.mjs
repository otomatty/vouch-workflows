import { verifyNativeReview } from "../../scripts/lib/native-review-evidence.mjs";
import capture from "../fixtures/native/codex-review-0.153.4.json" with {
  type: "json",
};
import { hookTest as test } from "../helpers/hook-test.mjs";

const observed = {
  events: capture.observation.events,
  providerRequests: capture.observation.providerRequests,
  expectedDraft: capture.draft,
  actualDraft: capture.draft,
  distributionUnchanged: true,
};

test("native review evidence verifies recorded relationships without claiming human consent", (t) => {
  t.plan(3);
  t.assert.deepEqual(verifyNativeReview(observed), []);
  t.assert.deepEqual(
    [
      capture.kind,
      capture.scripted,
      capture.humanApproval,
      capture.modelEvaluation,
    ],
    ["native-cli-observation", true, false, false],
  );
  t.assert.equal(
    capture.observation.results.every(
      (result) => result.observed && result.code === null,
    ),
    true,
  );
});

test("native review verification rejects a provider request or changed installation or draft", (t) => {
  t.plan(3);
  t.assert.equal(
    verifyNativeReview({ ...observed, providerRequests: 1 }).includes(
      "NATIVE-PROVIDER",
    ),
    true,
  );
  t.assert.equal(
    verifyNativeReview({
      ...observed,
      actualDraft: `${capture.draft}changed`,
    }).includes("NATIVE-DRAFT"),
    true,
  );
  t.assert.equal(
    verifyNativeReview({ ...observed, distributionUnchanged: false }).includes(
      "NATIVE-DISTRIBUTION",
    ),
    true,
  );
});

test("native review verification rejects malformed synthetic missing or unrelated evidence", (t) => {
  t.plan(5);
  t.assert.equal(
    verifyNativeReview({ ...observed, events: [] }).includes("NATIVE-EVENTS"),
    true,
  );
  t.assert.equal(
    verifyNativeReview({ ...observed, events: [{}] }).includes("NATIVE-EVENTS"),
    true,
  );
  t.assert.equal(
    verifyNativeReview({
      ...observed,
      events: observed.events.map((row) => ({ ...row, synthetic: true })),
    }).includes("NATIVE-EVENTS"),
    true,
  );
  t.assert.equal(
    verifyNativeReview({
      ...observed,
      events: observed.events.map((row) =>
        row.type === "intent.approved"
          ? { ...row, parent: `evt_${"0".repeat(64)}` }
          : row,
      ),
    }).includes("NATIVE-RELATION"),
    true,
  );
  t.assert.equal(
    verifyNativeReview({
      ...observed,
      events: observed.events.filter((row) => row.type !== "session.started"),
    }).includes("NATIVE-EVENTS"),
    true,
  );
});
