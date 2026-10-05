import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

test("explicit review command vocabulary has a closed registry contract", (t) => {
  const valid = validator("intent-review");
  const registry = readJson("core/registry/intent-review.json");
  t.plan(7);
  t.assert.equal(valid(registry), true);
  t.assert.equal(valid({ ...registry, open: "approve by default" }), false);
  t.assert.equal(valid({ ...registry, extra: true }), false);
  t.assert.equal(valid({ ...registry, gatePattern: ".*" }), false);
  t.assert.equal(valid({ ...registry, confirmPrefix: "yes" }), false);
  t.assert.equal(valid({ ...registry, targetPattern: ".*" }), false);
  const { targetPattern: _pattern, ...partial } = registry;
  t.assert.equal(valid(partial), false);
});

test("Claude Write captures preserve native stdin with their declared origin", (t) => {
  const raw = readFileSync(
    "tests/fixtures/captures/claude-2.1.280-write.jsonl",
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const valid = validator("harness-fixture");
  t.plan(11);
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const fixture = readJson(`tests/fixtures/harness/claude/${event}.json`);
    t.assert.equal(valid(fixture), true);
    t.assert.deepEqual(
      fixture.payload,
      raw.find((value) => value.hook_event_name === event),
    );
    t.assert.deepEqual(
      [fixture.harness, fixture.version, fixture.synthetic, fixture.provenance],
      ["claude", "2.1.280", false, "captured"],
    );
    t.assert.equal(fixture.source.commit, "eb5bbc5");
    t.assert.equal(fixture.payload.tool_name, "Write");
  }
  t.assert.equal(raw.length, 2);
});
