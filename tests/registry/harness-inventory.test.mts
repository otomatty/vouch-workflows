import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  captureRow,
  fixtureKind,
  readInventory,
} from "../helpers/fixtures.mjs";
import {
  isContractFixture,
  readJson,
  validator,
} from "../helpers/registry.mjs";

const inventory = readInventory();
const keyOf = (kind: { harness: string; event: string; tool: string | null }) =>
  `${kind.harness}:${kind.event}:${kind.tool ?? ""}`;
// docs/development/harness-fixtures.md: events and tools later guard and record hooks read.
const needed = [
  "claude:SessionStart:",
  "claude:UserPromptSubmit:",
  "claude:PreCompact:",
  "claude:PreToolUse:Write",
  "claude:PreToolUse:Edit",
  "claude:PreToolUse:Bash",
  "claude:PreToolUse:AskUserQuestion",
  "claude:PreToolUse:Agent",
  "claude:PostToolUse:Write",
  "claude:PostToolUse:Edit",
  "claude:PostToolUse:Bash",
  "claude:PostToolUse:AskUserQuestion",
  "claude:PostToolUse:Agent",
  "claude:SubagentStop:",
  "claude:Stop:",
  "codex:SessionStart:",
  "codex:UserPromptSubmit:",
  "codex:PreCompact:",
  "codex:PreToolUse:apply_patch",
  "codex:PreToolUse:Bash",
  "codex:PreToolUse:request_user_input",
  "codex:PreToolUse:collaborationspawn_agent",
  "codex:PostToolUse:apply_patch",
  "codex:PostToolUse:Bash",
  "codex:PostToolUse:request_user_input",
  "codex:PostToolUse:collaborationspawn_agent",
  "codex:SubagentStop:",
  "codex:Stop:",
];

test("inventory lists each needed harness event and tool once with its purpose", (t) => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    readJson("tests/fixtures/harness/inventory.schema.json"),
  );
  const keys = inventory.kinds.map(keyOf);
  const used = new Set(inventory.kinds.flatMap((kind) => kind.purposes));
  t.plan(5);
  t.assert.equal(
    validate(inventory),
    true,
    `TEST-7: ${JSON.stringify(validate.errors)}`,
  );
  t.assert.equal(new Set(keys).size, keys.length, "TEST-7: one entry per kind");
  t.assert.deepEqual([...keys].sort(), [...needed].sort(), "TEST-7: needs");
  t.assert.deepEqual(
    [...used].filter((name) => !(name in inventory.purposes)),
    [],
    "TEST-7: every purpose is defined",
  );
  t.assert.deepEqual(
    Object.keys(inventory.purposes).filter((name) => !used.has(name)),
    [],
    "TEST-7: every defined purpose is needed",
  );
});

test("every needed kind has a versioned native capture", (t) => {
  t.plan(1);
  t.assert.deepEqual(
    inventory.kinds.filter((kind) => kind.fixtures.length === 0).map(keyOf),
    [],
    "TEST-7: kinds without a native capture cannot run contracts",
  );
});

test("inventoried fixtures are captures whose payload is the keyed raw row", (t) => {
  const listed = inventory.kinds.flatMap((kind) =>
    kind.fixtures.map((path) => ({ kind, path })),
  );
  const validate = validator("harness-fixture");
  t.plan(listed.length * 5);
  for (const { kind, path } of listed) {
    const fixture: import("../../core/hooks/lib/contracts.mjs").HarnessFixture =
      readJson(path);
    const record = inventory.captures[fixture.source?.path ?? ""];
    t.assert.equal(validate(fixture), true, `HOOK-14: ${path}`);
    t.assert.equal(
      isContractFixture(fixture) && fixture.provenance === "captured",
      true,
      `TEST-7: ${path} is a versioned capture`,
    );
    t.assert.deepEqual(
      fixtureKind(fixture),
      { harness: kind.harness, event: kind.event, tool: kind.tool },
      `TEST-7: ${path} is listed under its own kind`,
    );
    t.assert.deepEqual(
      [record?.harness, record?.version, record?.commit],
      [fixture.harness, fixture.version, fixture.source?.commit],
      `TEST-7: ${path} matches its capture record`,
    );
    t.assert.deepEqual(
      fixture.payload,
      captureRow(fixture),
      `TEST-7: ${path} payload equals the raw row`,
    );
  }
});

test("every captured wrapper is inventoried and imported legacy stays unversioned", (t) => {
  const own = [
    "tests/fixtures/harness/synthetic.json",
    "tests/fixtures/harness/inventory.json",
    "tests/fixtures/harness/inventory.schema.json",
  ];
  const wrappers = readdirSync("tests/fixtures/harness", {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => `${entry.parentPath}/${entry.name}`.replaceAll("\\", "/"))
    .filter((path) => !own.includes(path))
    .map((path) => ({ path, fixture: readJson(path) }));
  const listed = new Set(inventory.kinds.flatMap((kind) => kind.fixtures));
  const imported = wrappers.filter(
    ({ fixture }) => fixture.provenance === "imported",
  );
  t.plan(4);
  t.assert.deepEqual(
    wrappers
      .filter(({ fixture }) => fixture.provenance === "captured")
      .map(({ path }) => path)
      .sort(),
    [...listed].sort(),
    "TEST-7: captured wrappers and the inventory agree",
  );
  t.assert.equal(imported.length, 9, "TEST-7: legacy Codex payloads");
  t.assert.equal(
    imported.every(
      ({ path, fixture }) =>
        fixture.version === null &&
        !listed.has(path) &&
        !isContractFixture(fixture),
    ),
    true,
    "TEST-7: unknown versions are never inventoried",
  );
  t.assert.equal(
    wrappers.every(({ fixture }) => fixture.provenance !== "synthetic"),
    true,
    "TEST-7: authored examples stay in synthetic.json",
  );
});

test("capture records keep recorder bytes and name the script and record that ran", (t) => {
  const records = Object.entries(inventory.captures);
  t.plan(records.length * 4);
  for (const [path, record] of records) {
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    t.assert.equal(lines.pop(), "", `TEST-7: ${path} ends with one newline`);
    t.assert.equal(
      lines.every((line) => {
        const row = JSON.parse(line);
        return (
          JSON.stringify(row) === line &&
          typeof row.hook_event_name === "string"
        );
      }),
      true,
      `TEST-7: ${path} holds one recorder line per event`,
    );
    t.assert.equal(existsSync(record.script), true, `TEST-7: ${path} script`);
    t.assert.equal(
      existsSync(record.record.split("#")[0] ?? ""),
      true,
      `TEST-7: ${path} record`,
    );
  }
});
