import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isContractFixture,
  readJson,
  validator,
} from "../helpers/registry.mjs";

for (const event of ["SessionStart", "UserPromptSubmit"]) {
  test(`Codex ${event} preserves versioned CLI input independently of legacy fixtures`, (t) => {
    const fixture = readJson(
      `tests/fixtures/harness/codex/0.153.4/${event}.json`,
    );
    const rows = readFileSync(
      "tests/fixtures/captures/codex-0.153.4.jsonl",
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    t.plan(6);
    t.assert.equal(validator("harness-fixture")(fixture), true);
    t.assert.equal(isContractFixture(fixture), true);
    t.assert.deepEqual(
      [fixture.harness, fixture.version, fixture.provenance, fixture.synthetic],
      ["codex", "0.153.4", "captured", false],
    );
    t.assert.deepEqual(fixture.source, {
      path: "tests/fixtures/captures/codex-0.153.4.jsonl",
      commit: "99230c6",
      key: event,
    });
    t.assert.equal(
      rows.filter((row) => row.hook_event_name === event).length,
      1,
    );
    t.assert.deepEqual(
      fixture.payload,
      rows.find((row) => row.hook_event_name === event),
    );
  });
}
