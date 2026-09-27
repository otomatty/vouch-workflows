import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isContractFixture,
  readJson,
  validator,
} from "../helpers/registry.mjs";

test("Claude UserPromptSubmit is a versioned capture with unmodified raw payload", (t) => {
  const fixture = readJson(
    "tests/fixtures/harness/claude/UserPromptSubmit.json",
  );
  const raw = readFileSync(
    "tests/fixtures/captures/claude-2.1.280.jsonl",
    "utf8",
  );
  t.plan(6);
  t.assert.equal(validator("harness-fixture")(fixture), true);
  t.assert.equal(isContractFixture(fixture), true);
  t.assert.equal(fixture.version, "2.1.280");
  t.assert.equal(fixture.synthetic, false);
  t.assert.equal(
    fixture.source.path,
    "tests/fixtures/captures/claude-2.1.280.jsonl",
  );
  t.assert.deepEqual(fixture.payload, JSON.parse(raw));
});
