import { test } from "node:test";
import { contractReference, deriveFixture } from "../helpers/fixtures.mjs";
import { readJson } from "../helpers/registry.mjs";

const edit = readJson(
  "tests/fixtures/harness/claude/2.1.283/linux/print/PreToolUse.Edit.json",
);
const patch = readJson(
  "tests/fixtures/harness/codex/0.153.4/linux/exec/PreToolUse.apply_patch.json",
);

test("contract execution accepts inventoried captures and same-version derivations", (t) => {
  const derived = deriveFixture(edit, { cwd: "/elsewhere" });
  t.plan(6);
  t.assert.deepEqual(contractReference(edit), edit);
  t.assert.deepEqual(contractReference(derived), edit);
  t.assert.deepEqual(
    [derived.harness, derived.version, derived.synthetic, derived.provenance],
    ["claude", edit.version, true, "synthetic"],
    "TEST-7: derived input is marked and keeps the capture version",
  );
  t.assert.deepEqual(derived.source, edit.source);
  t.assert.deepEqual(derived.payload, { ...edit.payload, cwd: "/elsewhere" });
  t.assert.deepEqual(
    contractReference(deriveFixture(patch, { cwd: "/elsewhere" })),
    patch,
  );
});

test("contract execution refuses kinds and versions without a native capture", (t) => {
  const legacyPlan = readJson(
    "tests/fixtures/harness/codex/postToolUse_updatePlan.json",
  );
  const legacyPatch = readJson(
    "tests/fixtures/harness/codex/postToolUse_applyPatch_plain.json",
  );
  const refused = [
    legacyPlan,
    legacyPatch,
    {
      ...legacyPlan,
      synthetic: true,
      provenance: "synthetic",
      version: "0.153.4",
    },
    { ...deriveFixture(edit, {}), version: "2.1.280" },
    { ...edit, payload: { ...edit.payload, cwd: "/changed" } },
    deriveFixture(edit, { tool_name: "NotebookEdit" }),
    { ...deriveFixture(edit, {}), harness: "codex" },
  ];
  t.plan(refused.length + 2);
  for (const fixture of refused)
    t.assert.throws(() => contractReference(fixture), /TEST-7/);
  t.assert.throws(
    () => deriveFixture(legacyPatch, {}),
    /TEST-7/,
    "unknown versions are never a derivation base",
  );
  t.assert.throws(
    () => deriveFixture(deriveFixture(edit, {}), {}),
    /TEST-7/,
    "derivations start from a capture",
  );
});

test("synthetic inputs must name the inventoried capture they derive from", (t) => {
  const write = readJson(
    "tests/fixtures/harness/claude/2.1.283/linux/print/PreToolUse.Write.json",
  );
  const windows = readJson("tests/fixtures/harness/claude/PreToolUse.json");
  const { source: _source, ...unsourced } = deriveFixture(edit, {});
  const refused = [
    unsourced,
    {
      ...deriveFixture(edit, {}),
      source: { ...edit.source, key: "PreToolUse.Edit#2" },
    },
    { ...deriveFixture(write, {}), source: windows.source },
    { ...deriveFixture(edit, {}), source: write.source },
  ];
  t.plan(refused.length);
  for (const [index, fixture] of refused.entries())
    t.assert.throws(
      () => contractReference(fixture),
      /TEST-7/,
      `TEST-7: origin case ${index}`,
    );
});
