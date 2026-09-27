import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isContractFixture,
  readJson,
  validator,
} from "../helpers/registry.mjs";

test("SessionStart capture preserves the original CLI payload and version", (t) => {
  const fixture = readJson("tests/fixtures/harness/claude/SessionStart.json");
  t.plan(4);
  t.assert.equal(validator("harness-fixture")(fixture), true);
  t.assert.equal(isContractFixture(fixture), true);
  t.assert.equal(fixture.version, "2.1.280");
  t.assert.deepEqual(
    fixture.payload,
    JSON.parse(readFileSync(fixture.source.path, "utf8")),
  );
});

test("session hook schema handles only startup and keeps the common input requirements", (t) => {
  const validate = validator("session-start-hook");
  const fixture = readJson(
    "tests/fixtures/harness/claude/SessionStart.json",
  ).payload;
  t.plan(4);
  t.assert.equal(validate(fixture), true);
  t.assert.equal(validate({ ...fixture, source: "resume" }), false);
  t.assert.equal(validate({ ...fixture, session_id: 3 }), false);
  t.assert.equal(
    validate({ hook_event_name: "SessionStart", source: "startup" }),
    false,
  );
});
