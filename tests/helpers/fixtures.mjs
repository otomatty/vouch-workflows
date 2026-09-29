import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { isContractFixture, readJson } from "./registry.mjs";

/**
 * docs/development/harness-fixtures.md; structure in inventory.schema.json.
 * @typedef {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} HarnessFixture
 * @typedef {{harness:'claude'|'codex',event:string,tool:string|null}} FixtureKind
 * @typedef {{type:string,scope:string,note:string}} FixtureConstraint
 * @typedef {FixtureKind & {purposes:string[],fixtures:string[],constraints:FixtureConstraint[]}} InventoryKind
 * @typedef {{harness:'claude'|'codex',version:string,platform:string,interactive:boolean,invocation:string,date:string,commit:string,script:string,record:string}} CaptureRecord
 * @typedef {{version:1,source:string,purposes:Record<string,{summary:string,source:string}>,captures:Record<string,CaptureRecord>,kinds:InventoryKind[]}} HarnessInventory
 */

/** @type {HarnessInventory|undefined} */
let inventory;

/** @returns {HarnessInventory} */
export function readInventory() {
  inventory ??= readJson("tests/fixtures/harness/inventory.json");
  return /** @type {HarnessInventory} */ (inventory);
}

/** Tool events are distinguished by tool; the others by event alone.
 * @param {HarnessFixture} fixture @returns {FixtureKind} */
export function fixtureKind(fixture) {
  const payload = fixture.payload;
  return {
    harness: fixture.harness,
    event: payload.hook_event_name,
    tool:
      payload.hook_event_name === "PreToolUse" ||
      payload.hook_event_name === "PostToolUse"
        ? payload.tool_name
        : null,
  };
}

/** The raw row named by `<event>[.<tool>][#<n>]`; a missing ordinal means the first.
 * @param {HarnessFixture} fixture @returns {unknown} */
export function captureRow(fixture) {
  const match = /^([A-Za-z]+)(?:\.([^#]+))?(?:#([1-9]\d*))?$/.exec(
    fixture.source?.key ?? "",
  );
  if (!match || !fixture.source) throw new Error("TEST-7: invalid capture key");
  const [, event, tool, ordinal] = match;
  const rows = readFileSync(fixture.source.path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(
      (row) =>
        row.hook_event_name === event &&
        (tool === undefined || row.tool_name === tool),
    );
  const row = rows[Number(ordinal ?? "1") - 1];
  if (row === undefined) throw new Error("TEST-7: capture key has no row");
  return row;
}

/**
 * The inventoried capture that makes `fixture` eligible for contract execution.
 * Captures qualify as themselves; a synthetic input qualifies through the capture its
 * source names, which must be of the same kind and version.
 * @param {HarnessFixture} fixture @returns {HarnessFixture}
 */
export function contractReference(fixture) {
  const kind = fixtureKind(fixture);
  const entry = readInventory().kinds.find(
    (item) =>
      item.harness === kind.harness &&
      item.event === kind.event &&
      item.tool === kind.tool,
  );
  /** @type {HarnessFixture[]} */
  const captures = (entry?.fixtures ?? []).map((path) => readJson(path));
  const reference = fixture.synthetic
    ? fixture.provenance === "synthetic"
      ? captures.find(
          (capture) =>
            capture.version === fixture.version &&
            isDeepStrictEqual(capture.source, fixture.source),
        )
      : undefined
    : captures.find((capture) => isDeepStrictEqual(capture, fixture));
  if (!reference)
    throw new Error(
      `TEST-7: no inventoried ${fixture.version ?? "unversioned"} capture for ${kind.harness} ${kind.event}${kind.tool ? ` ${kind.tool}` : ""}`,
    );
  return reference;
}

/** Changed inputs keep the capture's harness, version and origin and are marked synthetic.
 * @param {HarnessFixture} capture @param {Record<string,unknown>} changes
 * @returns {HarnessFixture} */
export function deriveFixture(capture, changes) {
  if (capture.provenance !== "captured" || !isContractFixture(capture))
    throw new Error("TEST-7: derivations start from an inventoried capture");
  contractReference(capture);
  return /** @type {HarnessFixture} */ ({
    ...capture,
    synthetic: true,
    provenance: "synthetic",
    payload: { ...capture.payload, ...changes },
  });
}
