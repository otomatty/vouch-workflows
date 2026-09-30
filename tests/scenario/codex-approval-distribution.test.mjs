import { exerciseApprovalDistribution } from "../helpers/approval-distribution.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";

test("copied codex registrations confirm, apply the approval and then admit implementation writes", (t) =>
  exerciseApprovalDistribution(t, "codex"));
