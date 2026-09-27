import { test } from "node:test";
import { exerciseReviewDistribution } from "../helpers/review-distribution.mjs";

test("claude installed review registration consumes explicit inputs and preserves the draft", (t) =>
  exerciseReviewDistribution(t, "claude"));
