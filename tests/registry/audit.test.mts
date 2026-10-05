import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

const expected = [
  "intent.created",
  "intent.approved",
  "intent.completed",
  "stage.started",
  "stage.completed",
  "unit.started",
  "unit.completed",
  "checkpoint.confirmed",
  "gate.opened",
  "gate.approved",
  "gate.rejected",
  "question.asked",
  "question.answered",
  "question.defaulted",
  "aside.asked",
  "aside.answered",
  "hook.check",
  "hook.denied",
  "review.requested",
  "review.completed",
  "knowledge.refreshed",
  "session.started",
  "session.resumed",
  "session.compacted",
  "session.ended",
  "learn.recorded",
  "migration.completed",
];

test("audit registry contains every event named in Q1", (t) => {
  const registry = readJson("core/registry/audit-events.json");
  const validate = validator("audit-events");
  t.plan(2);
  t.assert.equal(
    validate(registry),
    true,
    `REG-1: ${JSON.stringify(validate.errors)}`,
  );
  t.assert.deepEqual(
    Object.keys(registry.events).sort(),
    [...expected].sort(),
    "REG-1: Q1 event set",
  );
});

test("audit metadata agrees with wire fields and reciprocal pairs", (t) => {
  const registry = readJson("core/registry/audit-events.json");
  const schema = readJson("core/registry/audit-event.schema.json");
  t.plan(expected.length * 5);
  for (const name of expected) {
    const entry = registry.events[name];
    const wire = schema.oneOf.find(
      (s: { properties: { type: { const?: string } } }) =>
        s.properties.type.const === name,
    );
    t.assert.deepEqual(
      [
        ...new Set([...registry.common.required, ...entry.fields.required]),
      ].sort(),
      [...wire.required].sort(),
      `REG-1: ${name} required`,
    );
    t.assert.deepEqual(
      [
        ...new Set([
          ...registry.common.required,
          ...registry.common.optional,
          ...entry.fields.required,
          ...entry.fields.optional,
        ]),
      ].sort(),
      Object.keys(wire.properties).sort(),
      `REG-1: ${name} fields`,
    );
    t.assert.equal(
      entry.pairs_with.every((pair: string) =>
        registry.events[pair]?.pairs_with.includes(name),
      ),
      true,
      `REG-1: ${name} pairs`,
    );
    t.assert.equal(
      entry.measures.every((measure: string) => {
        let property = wire;
        for (const key of measure.split("."))
          property = property?.properties?.[key];
        return property !== undefined;
      }),
      true,
      `REG-1: ${name} measures`,
    );
    t.assert.equal(
      new Set(entry.fields.required).size,
      entry.fields.required.length,
      `REG-1: ${name} duplicate required`,
    );
  }
});

test("audit fixtures cover the registry and declare synthetic provenance", (t) => {
  const files = readdirSync("tests/fixtures/audit").filter((file) =>
    file.endsWith(".jsonl"),
  );
  const validate = validator("audit-event");
  t.plan(1 + expected.length * 3);
  t.assert.deepEqual(
    files.sort(),
    expected.map((name) => `${name}.jsonl`).sort(),
    "REG-2: fixture set",
  );
  for (const name of expected) {
    const text = readFileSync(`tests/fixtures/audit/${name}.jsonl`, "utf8");
    const event = JSON.parse(text.trim());
    t.assert.equal(
      validate(event),
      true,
      `REG-1: ${name}: ${JSON.stringify(validate.errors)}`,
    );
    t.assert.deepEqual(
      [event.type, event.synthetic],
      [name, true],
      "REG-2/TEST-7",
    );
    t.assert.equal(
      text.trim().split("\n").length,
      1,
      "REG-2: one JSONL example per type",
    );
  }
});

test("audit records reject missing fields and unknown types", (t) => {
  const validate = validator("audit-event");
  const schema = readJson("core/registry/audit-event.schema.json");
  const cases = expected.flatMap((name) => {
    const sample = JSON.parse(
      readFileSync(`tests/fixtures/audit/${name}.jsonl`, "utf8"),
    );
    const wire = schema.oneOf.find(
      (s: { properties: { type: { const?: string } } }) =>
        s.properties.type.const === name,
    );
    return wire.required.map((key: string) => {
      const invalid = structuredClone(sample);
      delete invalid[key];
      return { name, key, invalid };
    });
  });
  t.plan(cases.length + 1);
  for (const { name, key, invalid } of cases)
    t.assert.equal(validate(invalid), false, `REG-1: ${name} missing ${key}`);
  t.assert.equal(
    validate({
      id: "x",
      v: 1,
      ts: "2026-09-27T00:00:00Z",
      actor: "hook",
      type: "invented.event",
    }),
    false,
    "REG-1",
  );
});

test("audit schema rejects invalid measurements and unauthorized token fields", (t) => {
  const validate = validator("audit-event");
  const base = {
    id: "x",
    v: 1,
    type: "hook.check",
    ts: "2026-09-27T00:00:00Z",
    actor: "hook",
    check: "citation",
    result: "pass",
    duration_ms: 0,
  };
  const invalid = [
    { duration_ms: -1 },
    { duration_ms: 0.5 },
    { duration_ms: "1" },
    { ts: "2026-09-27T00:00:00+09:00" },
    { actor: "robot" },
    { check: "invented" },
    { result: "unknown" },
    { v: 2 },
    { extra: true },
    { tokens: { in: 1, out: 2 } },
    { harness: "codex", tokens: { in: 1, out: 2 } },
    { harness: "claude", tokens: { in: -1, out: 2 } },
  ];
  t.plan(invalid.length + 2);
  t.assert.equal(
    validate({ ...base, harness: "codex" }),
    true,
    "REG-1: Codex without tokens",
  );
  t.assert.equal(
    validate({
      ...base,
      harness: "claude",
      tokens: { in: 1, out: 2, cache: 0 },
    }),
    true,
    "REG-1: Claude tokens",
  );
  for (const patch of invalid)
    t.assert.equal(
      validate({ ...base, ...patch }),
      false,
      `REG-1: ${JSON.stringify(patch)}`,
    );
});

test("audit conditional fields distinguish build, human approval and defaultable questions", (t) => {
  const validate = validator("audit-event");
  const base = {
    id: "x",
    v: 1,
    ts: "2026-09-27T00:00:00Z",
    actor: "model",
    intent: "test",
  };
  t.plan(7);
  t.assert.equal(
    validate({
      ...base,
      type: "stage.completed",
      stage: "build",
      parent: "start",
      duration_ms: 1,
    }),
    false,
    "REG-1: Build counters",
  );
  t.assert.equal(
    validate({
      ...base,
      type: "gate.approved",
      source: "intent",
      parent: "open",
      wait_ms: 1,
    }),
    false,
    "REG-1: human actor",
  );
  t.assert.equal(
    validate({
      ...base,
      type: "checkpoint.confirmed",
      actor: "human",
      checkpoint: "unit",
    }),
    false,
    "REG-1: unit checkpoint",
  );
  t.assert.equal(
    validate({
      ...base,
      type: "question.asked",
      question: "Q-1",
      blocking: false,
      options: 2,
    }),
    false,
    "REG-1: default needed",
  );
  t.assert.equal(
    validate({
      ...base,
      type: "question.asked",
      question: "Q-1",
      blocking: true,
      options: 2,
    }),
    true,
    "REG-1: no viable default",
  );
  t.assert.equal(
    validate({
      ...base,
      type: "legacy.SWARM_STARTED",
      original_type: "SWARM_STARTED",
      raw: "original bytes",
      source_path: "audit.md",
    }),
    true,
    "REG-3: raw legacy",
  );
  t.assert.equal(
    validate({
      ...base,
      type: "legacy.SWARM_STARTED",
      original_type: "SWARM_STARTED",
      source_path: "audit.md",
    }),
    false,
    "REG-3: raw required",
  );
});
