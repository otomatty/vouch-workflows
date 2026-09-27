import { mock } from "node:test";

const instant = process.env.VOUCH_TEST_TIME;
if (!instant) throw new Error("TEST-5: a fixed clock is required");
mock.timers.enable({ apis: ["Date"], now: Date.parse(instant) });
