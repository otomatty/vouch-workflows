import { test } from "node:test";
import { parseIntentReviewCommand } from "../../../core/hooks/lib/intent-review.mjs";

test("review commands are exact operator inputs and do not infer consent", (t) => {
  const gate = `evt_${"a".repeat(64)}`;
  const cases = [
    ["vouch review", { kind: "open" }],
    [`vouch approve ${gate}`, { kind: "approve", gate }],
    ["yes", null],
    ["承認します", null],
    [`Please vouch approve ${gate}`, null],
    ["vouch reviewer", null],
    ["vouch review ", { kind: "invalid" }],
    ["vouch review\n", { kind: "invalid" }],
    ["vouch approve", { kind: "invalid" }],
    ["vouch approve nope", { kind: "invalid" }],
    [`vouch approve ${gate}\n`, { kind: "invalid" }],
    [`vouch approve ${gate} `, { kind: "invalid" }],
    [`vouch approve evt_${"A".repeat(64)}`, { kind: "invalid" }],
    [" vouch review", null],
    ["vouch approveX", null],
  ];
  t.plan(cases.length);
  for (const [input, expected] of cases)
    t.assert.deepEqual(parseIntentReviewCommand(String(input)), expected);
});
