import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isContractFixture,
  readJson,
  validator,
} from "../helpers/registry.mjs";

test("input schema accepts imported Codex payloads without inventing version evidence", (t) => {
  const original = readJson(
    "docs/aidlc-v2-reference/tests/fixtures/codex-hook-payloads/payloads.json",
  );
  const files = readdirSync("tests/fixtures/harness/codex").filter((name) =>
    name.endsWith(".json"),
  );
  const validate = validator("harness-fixture");
  t.plan(files.length * 5 + 1);
  t.assert.deepEqual(
    files.map((f) => f.replace(".json", "")).sort(),
    Object.keys(original).sort(),
    "TEST-7: every imported payload",
  );
  for (const file of files) {
    const fixture = readJson(`tests/fixtures/harness/codex/${file}`);
    t.assert.equal(
      validate(fixture),
      true,
      `HOOK-14: ${file}: ${JSON.stringify(validate.errors)}`,
    );
    t.assert.deepEqual(
      fixture.payload,
      original[fixture.source.key],
      "TEST-7: unchanged payload",
    );
    t.assert.deepEqual(
      [fixture.harness, fixture.version, fixture.synthetic, fixture.provenance],
      ["codex", null, false, "imported"],
      "TEST-7: provenance",
    );
    t.assert.equal(fixture.source.commit, "a1aedb4", "TEST-7: origin");
    t.assert.equal(
      isContractFixture(fixture),
      false,
      "TEST-7: unknown version is not eligible",
    );
  }
});

test("synthetic input examples exercise all seven shapes without qualifying as captures", (t) => {
  const fixtures = readJson("tests/fixtures/harness/synthetic.json");
  const validate = validator("harness-fixture");
  t.plan(fixtures.length * 2 + 1);
  t.assert.deepEqual(
    fixtures
      .map(
        (f: import("../../core/hooks/lib/contracts.mjs").HarnessFixture) =>
          f.payload.hook_event_name,
      )
      .sort(),
    [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PreCompact",
      "SubagentStop",
      "Stop",
    ].sort(),
    "HOOK-14: planned inputs",
  );
  for (const fixture of fixtures) {
    t.assert.equal(
      validate(fixture),
      true,
      `TEST-7: ${JSON.stringify(validate.errors)}`,
    );
    t.assert.equal(
      isContractFixture(fixture),
      false,
      "TEST-7: authored example",
    );
  }
});

test("input schemas accept unknown fields and reject malformed structure", (t) => {
  const validate = validator("hook-input");
  const input = {
    session_id: "test",
    cwd: "/test",
    hook_event_name: "PostToolUse",
    tool_name: "apply_patch",
    tool_input: { command: "patch", future: 1 },
    tool_response: "done",
  };
  const invalid = [
    null,
    [],
    {},
    { ...input, session_id: "" },
    { ...input, cwd: 0 },
    { ...input, tool_input: "patch" },
    { ...input, hook_event_name: "Unknown" },
    { ...input, tool_response: undefined },
  ];
  t.plan(invalid.length + 2);
  t.assert.equal(
    validate({ ...input, future_field: { anything: true } }),
    true,
    "HOOK-14: forward-compatible input",
  );
  t.assert.equal(
    validate({ ...input, tool_input: { file_path: "../outside" } }),
    true,
    "HOOK-14: path containment is explicitly a future fs check",
  );
  for (const value of invalid)
    t.assert.equal(validate(value), false, `HOOK-14: ${JSON.stringify(value)}`);
});

test("input schemas require each event specific field", (t) => {
  const validate = validator("hook-input");
  const cases = {
    SessionStart: ["source"],
    UserPromptSubmit: ["prompt"],
    PreToolUse: ["tool_name", "tool_input"],
    PostToolUse: ["tool_name", "tool_input", "tool_response"],
    PreCompact: ["trigger"],
    SubagentStop: ["agent_id"],
    Stop: ["stop_hook_active"],
  };
  t.plan(Object.values(cases).flat().length);
  const fixtures = readJson("tests/fixtures/harness/synthetic.json");
  for (const [name, keys] of Object.entries(cases))
    for (const key of keys) {
      const example = structuredClone(
        fixtures.find(
          (f: import("../../core/hooks/lib/contracts.mjs").HarnessFixture) =>
            f.payload.hook_event_name === name,
        ).payload,
      );
      delete example[key];
      t.assert.equal(
        validate(example),
        false,
        `HOOK-14: ${name} missing ${key}`,
      );
    }
});

test("fixture schema rejects false capture claims and contradictory provenance", (t) => {
  const validate = validator("harness-fixture");
  const sample = readJson("tests/fixtures/harness/codex/sessionStart.json");
  t.plan(5);
  t.assert.equal(
    validate({ ...sample, provenance: "captured" }),
    false,
    "TEST-7: capture needs version",
  );
  t.assert.equal(
    validate({ ...sample, synthetic: true }),
    false,
    "TEST-7: contradictory origin",
  );
  t.assert.equal(
    validate({ ...sample, provenance: "synthetic" }),
    false,
    "TEST-7: authored needs marker",
  );
  t.assert.equal(
    validate({ ...sample, harness: "unknown" }),
    false,
    "TEST-7: harness",
  );
  t.assert.equal(
    isContractFixture({
      ...sample,
      synthetic: true,
      provenance: "synthetic",
      version: "test-only",
    }),
    false,
    "TEST-7: version never makes synthetic eligible",
  );
});

test("hook result schema requires denial reasons and registered audit events", (t) => {
  const validate = validator("hook-result");
  const event = JSON.parse(
    readFileSync("tests/fixtures/audit/hook.check.jsonl", "utf8"),
  );
  t.plan(6);
  t.assert.equal(validate({ decision: "allow" }), true, "HOOK-3: allow");
  t.assert.equal(
    validate({
      decision: "deny",
      reason: "REF-EMPTY: missing sources",
      events: [event],
    }),
    true,
    "HOOK-3: deny",
  );
  t.assert.equal(
    validate({ decision: "deny" }),
    false,
    "HOOK-3: reason required",
  );
  t.assert.equal(
    validate({ decision: "deny", reason: "" }),
    false,
    "HOOK-3: empty reason",
  );
  t.assert.equal(
    validate({
      decision: "allow",
      events: [{ ...event, type: "unknown.event" }],
    }),
    false,
    "HOOK-10: event type",
  );
  t.assert.equal(
    validate({ decision: "defer" }),
    false,
    "HOOK-3: no third decision",
  );
});

test("process observation schema permits only exit zero or justified exit two", (t) => {
  const validate = validator("hook-process");
  t.plan(4);
  t.assert.equal(
    validate({ exitCode: 0, stdout: null, stderr: "" }),
    true,
    "HOOK-3: no-op",
  );
  t.assert.equal(
    validate({ exitCode: 2, stdout: null, stderr: "REF-EMPTY: reason" }),
    true,
    "HOOK-3: denial",
  );
  t.assert.equal(
    validate({ exitCode: 1, stdout: null, stderr: "error" }),
    false,
    "HOOK-3: invalid exit",
  );
  t.assert.equal(
    validate({ exitCode: 2, stdout: null, stderr: "" }),
    false,
    "HOOK-3: silent denial",
  );
});
