import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import events from "../../core/registry/audit-events.json" with {
  type: "json",
};
import runtime from "../../core/registry/runtime.json" with { type: "json" };
import { readJson } from "../helpers/registry.mjs";

const emission = readJson("core/registry/audit-emission.json");

const operations = [
  "intent-created",
  "intent-completed",
  "stage-started",
  "stage-completed",
  "unit-started",
  "unit-completed",
  "gate-approved",
  "gate-rejected",
  "review-requested",
  "review-completed",
  "learn-recorded",
  "session-ended",
];

test("the emission ledger matches the 27-event registry and its schema", (t) => {
  const schema = readJson("core/registry/audit-emission.schema.json");
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    schema,
  );
  t.plan(4);
  t.assert.equal(validate(emission), true, JSON.stringify(validate.errors));
  t.assert.deepEqual(
    Object.keys(emission.events).sort(),
    Object.keys(events.events).sort(),
  );
  t.assert.deepEqual(emission.operations, operations);
  t.assert.equal(
    emission.events["stage.completed"]?.hook === emission.driver,
    false,
  );
});

test("every event names a real product hook, input and contract test", (t) => {
  const entries = Object.entries(emission.events);
  t.plan(entries.length);
  for (const [type, row] of entries) {
    const hookFile = `core/${row.hook}`;
    const name = row.hook.slice("hooks/".length);
    const registered = [...runtime.hooks, ...runtime.commands];
    const subprocess = readFileSync(row.tests.subprocess, "utf8");
    const fixtureOk =
      row.input.class !== "captured" ||
      [row.input.fixture, ...(row.input.also ?? [])].every((path) => {
        const fixture = readJson(path);
        return (
          existsSync(path) &&
          fixture.synthetic === false &&
          fixture.provenance === "captured"
        );
      });
    t.assert.deepEqual(
      [
        existsSync(hookFile),
        registered.includes(name),
        row.hook !== emission.driver,
        row.input.class !== "command" || runtime.commands.includes(name),
        row.migration === undefined || row.migration !== row.hook,
        existsSync(row.tests.positive),
        existsSync(row.tests.negative),
        subprocess.includes(type),
        row.tests.subprocess.startsWith("tests/hooks/") ||
          row.tests.subprocess.startsWith("tests/scenario/"),
        !row.tests.subprocess.startsWith("tests/unit/"),
        emission.store_tests.every(
          (/** @type {string} */ path) =>
            existsSync(path) && path !== row.tests.subprocess,
        ),
        fixtureOk,
        row.operation === undefined || operations.includes(row.operation),
      ],
      Array(13).fill(true),
      type,
    );
  }
});
