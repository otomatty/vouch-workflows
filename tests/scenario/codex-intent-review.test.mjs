import { test } from "node:test";
import { exerciseReviewDistribution } from "../helpers/review-distribution.mjs";

test("codex installed review registration consumes explicit inputs and preserves the draft", (t) =>
  exerciseReviewDistribution(t, "codex"));
