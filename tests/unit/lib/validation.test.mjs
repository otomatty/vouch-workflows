import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertSupportedSchema,
  isAuditEvent,
  isHookResult,
  parseInput,
} from "../../../core/hooks/lib/validation.mjs";
import { readJson, validator } from "../../helpers/registry.mjs";

test("input validation matches Ajv and drops unknown top level fields", (t) => {
  const fixture = readJson(
    "tests/fixtures/harness/claude/UserPromptSubmit.json",
  ).payload;
  const valid = { ...fixture, future: "ignored" };
  const parsed = parseInput(JSON.stringify(valid));
  t.plan(5);
  t.assert.deepEqual(parsed, fixture);
  t.assert.equal(validator("hook-input")(valid), true);
  t.assert.equal(parseInput("not json"), null);
  t.assert.equal(parseInput("{}"), null);
  t.assert.equal(parseInput(JSON.stringify({ ...fixture, prompt: 3 })), null);
});

test("unsupported schema vocabulary and references fail closed before evaluation", (t) => {
  t.plan(4);
  t.assert.throws(
    () => assertSupportedSchema(/** @type {never} */ ({ maxLength: 1 })),
    /REG-1: unsupported/,
  );
  t.assert.throws(
    () => assertSupportedSchema({ $ref: "https://invalid.example/schema" }),
    /REG-1: unsupported/,
  );
  t.assert.throws(
    () => assertSupportedSchema({ type: "invented" }),
    /REG-1: unsupported/,
  );
  t.assert.doesNotThrow(() =>
    assertSupportedSchema({ type: ["string", "boolean"] }),
  );
});

test("all synthetic input shapes and required-field mutations agree with Ajv", (t) => {
  const validate = validator("hook-input");
  const fixtures = readJson("tests/fixtures/harness/synthetic.json");
  const cases = fixtures.flatMap(
    (
      /** @type {import('../../../core/hooks/lib/contracts.mjs').HarnessFixture} */ fixture,
    ) => [
      fixture.payload,
      ...Object.keys(fixture.payload).map((key) =>
        Object.fromEntries(
          Object.entries(fixture.payload).filter(([field]) => field !== key),
        ),
      ),
    ],
  );
  cases.push(
    {
      session_id: "s",
      cwd: "r",
      hook_event_name: "UserPromptSubmit",
      prompt: "💡",
    },
    {
      session_id: "s",
      cwd: "r",
      hook_event_name: "Stop",
      stop_hook_active: "false",
    },
  );
  t.plan(cases.length);
  for (const value of cases)
    t.assert.equal(
      parseInput(JSON.stringify(value)) !== null,
      validate(value),
      JSON.stringify(value),
    );
});

test("audit validation agrees with Ajv for fixtures and field mutations", (t) => {
  const validate = validator("audit-event");
  const cases = readdirSync("tests/fixtures/audit")
    .map((file) =>
      JSON.parse(readFileSync(`tests/fixtures/audit/${file}`, "utf8")),
    )
    .flatMap((event) => [
      event,
      { ...event, v: 2 },
      { ...event, ts: 3 },
      { ...event, duration_ms: -1 },
      { ...event, duration_ms: 0.5 },
      { ...event, actor: null },
      { ...event, unexpected: true },
      { ...event, harness: "codex", tokens: { in: 1, out: 1 } },
    ]);
  cases.push(
    null,
    [],
    1,
    "event",
    {},
    {
      id: "x",
      v: 1,
      ts: "2026-09-27T00:00:00Z",
      actor: "hook",
      type: "legacy.OLD",
      original_type: "OLD",
      raw: "original",
      source_path: "old.md",
    },
  );
  t.plan(cases.length);
  for (const value of cases)
    t.assert.equal(
      isAuditEvent(value),
      validate(value),
      `REG-1: parity ${JSON.stringify(value)}`,
    );
});

test("result validation rejects malformed responses before writing events", (t) => {
  const validate = validator("hook-result");
  const cases = [
    { decision: "allow" },
    { decision: "deny", reason: "why" },
    { decision: "deny", reason: "" },
    { decision: "deny" },
    { decision: "allow", events: [{}] },
    { decision: "other" },
    null,
    [],
  ];
  t.plan(cases.length);
  for (const value of cases)
    t.assert.equal(
      isHookResult(value),
      validate(value),
      `HOOK-3: parity ${JSON.stringify(value)}`,
    );
});

test("early event-type rejection preserves Ajv decisions regardless of field order", (t) => {
  const validate = validator("audit-event");
  const fixtures = readdirSync("tests/fixtures/audit").map((file) =>
    JSON.parse(readFileSync(`tests/fixtures/audit/${file}`, "utf8")),
  );
  const cases = fixtures.flatMap((event) => {
    const { type, ...fields } = event;
    return [
      { ...fields, type },
      { type, ...fields },
      fields,
      { ...fields, type: "unknown" },
      { ...fields, type: null },
      { ...fields, type: { const: type } },
      { ...fields, type, actor: "unknown" },
    ];
  });
  t.plan(cases.length);
  for (const value of cases)
    t.assert.equal(isAuditEvent(value), validate(value), JSON.stringify(value));
});
