import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
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
  t.assert.deepEqual(
    parsed,
    Object.fromEntries(
      Object.entries(fixture).filter(([key]) => key !== "prompt_id"),
    ),
  );
  t.assert.equal(validator("hook-input")(valid), true);
  t.assert.equal(parseInput("not json"), null);
  t.assert.equal(parseInput("{}"), null);
  t.assert.equal(parseInput(JSON.stringify({ ...fixture, prompt: 3 })), null);
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
