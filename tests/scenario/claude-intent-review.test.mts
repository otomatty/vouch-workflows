import { hookTest as test } from "../helpers/hook-test.mjs";
import { exerciseReviewDistribution } from "../helpers/review-distribution.mjs";

test("claude installed review registration consumes explicit inputs and preserves the draft", (t) =>
  exerciseReviewDistribution(t, "claude"));
