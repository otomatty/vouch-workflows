import { test } from "node:test";
import { exerciseApprovalDistribution } from "../helpers/approval-distribution.mjs";

test("copied codex registrations confirm, apply the approval and then admit implementation writes", (t) =>
  exerciseApprovalDistribution(t, "codex"));
