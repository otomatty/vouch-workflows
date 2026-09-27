import { test } from "node:test";
import { newId, now } from "../../../core/hooks/lib/clock.mjs";

test("clock reports UTC using the supplied test clock", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1790467200000 });
  t.plan(1);
  t.assert.equal(now(), "2026-09-27T00:00:00.000Z");
});
test("event identity is stable and separates sessions and ambiguous components", (t) => {
  t.plan(4);
  t.assert.equal(newId("session", "input"), newId("session", "input"));
  t.assert.notEqual(newId("session", "input"), newId("other", "input"));
  t.assert.notEqual(newId("a:b", "c"), newId("a", "b:c"));
  t.assert.match(newId("session", "input"), /^evt_[a-f0-9]{64}$/);
});
