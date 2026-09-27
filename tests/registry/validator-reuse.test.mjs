import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

test("compiled validators are reused while every new input is independently checked", (t) => {
  const first = validator("audit-event");
  const second = validator("audit-event");
  const event = readJson("tests/fixtures/audit/hook.check.jsonl");
  t.plan(5);
  t.assert.equal(first, second);
  t.assert.equal(first(event), true);
  t.assert.equal(second({ ...event, actor: "unknown" }), false);
  t.assert.equal(first(event), true);
  t.assert.equal(first.errors, null);
});

test("unknown schema names remain rejected after valid schemas have been cached", (t) => {
  t.plan(3);
  t.assert.throws(() => validator("missing-one"), /REG-1/);
  t.assert.equal(validator("intent-review")({ version: 0 }), false);
  t.assert.throws(() => validator("missing-two"), /REG-1/);
});
