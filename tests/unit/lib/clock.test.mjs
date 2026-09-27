import { test } from "node:test";
import {
  elapsedMilliseconds,
  newId,
  now,
} from "../../../core/hooks/lib/clock.mjs";

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

test("elapsed UTC milliseconds validate calendar dates and time ordering", (t) => {
  const valid = [
    ["2024-02-29T23:59:59.9Z", "2024-03-01T00:00:00Z", 100],
    ["2026-09-27T00:00:00.01Z", "2026-09-27T00:00:00.011Z", 1],
    ["0000-01-01T00:00:00Z", "0000-01-01T00:00:00.000Z", 0],
    ["2026-09-27T00:00:00Z", "2026-09-27T00:00:01.050Z", 1050],
  ];
  const invalid = [
    "",
    "garbage",
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-01-00T00:00:00Z",
    "2026-01-32T00:00:00Z",
    "2026-09-27T24:00:00Z",
    "2026-09-27T00:60:00Z",
    "2026-09-27T00:00:60Z",
    "2026-09-27T00:00:00.0001Z",
    "2026-09-27T00:00:00",
    "2026-09-27T00:00:00+00:00",
    "2026-09-27T00:00:00Z\n",
  ];
  t.plan(valid.length + invalid.length * 2 + 3);
  t.assert.equal(elapsedMilliseconds("1970-01-01T00:00:00Z", "invalid"), null);
  t.assert.equal(elapsedMilliseconds("1969-12-31T23:59:59Z", "invalid"), null);
  for (const [start, end, expected] of valid)
    t.assert.equal(elapsedMilliseconds(String(start), String(end)), expected);
  for (const stamp of invalid) {
    t.assert.equal(
      elapsedMilliseconds(stamp, "2026-09-27T00:00:00Z"),
      null,
      stamp,
    );
    t.assert.equal(
      elapsedMilliseconds("2026-09-27T00:00:00Z", stamp),
      null,
      stamp,
    );
  }
  t.assert.equal(
    elapsedMilliseconds("2026-09-27T00:00:00.001Z", "2026-09-27T00:00:00Z"),
    null,
  );
});
