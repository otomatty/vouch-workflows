import { test } from "node:test";
import { createAuditStore } from "../../../core/hooks/lib/audit.mjs";
import { readJson } from "../../helpers/registry.mjs";
import { memoryFiles } from "../../helpers/runtime.mjs";

/** @returns {import('../../../core/hooks/lib/contracts.mjs').AuditEvent} */
function event() {
  return readJson("tests/fixtures/audit/hook.check.jsonl");
}

test("audit appends complete JSONL while preserving existing bytes and deduplicating", async (t) => {
  const first = { ...event(), id: "first" };
  const previous = `${JSON.stringify(first, null, 0)}\n`;
  const files = memoryFiles({ audit: previous });
  const audit = createAuditStore(files, "audit");
  t.plan(4);
  t.assert.equal(await audit.append([event()]), "appended");
  const after = await files.readText("audit");
  t.assert.equal(after, `${previous}${JSON.stringify(event())}\n`);
  t.assert.equal(await audit.append([event(), event()]), "duplicate");
  t.assert.equal(await files.readText("audit"), after);
});

test("audit rejects conflicting IDs without writing any part of a batch", async (t) => {
  const sample = event();
  const files = memoryFiles();
  const audit = createAuditStore(files, "audit");
  await audit.append([sample]);
  const before = await files.readText("audit");
  t.plan(3);
  t.assert.equal(
    await audit.append([
      /** @type {typeof sample} */ (
        Object.fromEntries(Object.entries(sample).reverse())
      ),
    ]),
    "duplicate",
  );
  await t.assert.rejects(
    audit.append([
      { ...sample, id: "new" },
      { ...sample, duration_ms: 99 },
    ]),
    /AUDIT-CONFLICT/,
  );
  t.assert.equal(await files.readText("audit"), before);
});

test("audit rejects broken existing logs and invalid new records", async (t) => {
  const line = JSON.stringify(event());
  const broken = [line, "not json\n", "{}\n", `${line}\n${line}\n`, "\n"];
  t.plan(broken.length * 2 + 3);
  for (const before of broken) {
    const files = memoryFiles({ audit: before });
    await t.assert.rejects(
      createAuditStore(files, "audit").append([event()]),
      /AUDIT-CORRUPT/,
    );
    t.assert.equal(await files.readText("audit"), before);
  }
  const files = memoryFiles();
  const audit = createAuditStore(files, "audit");
  await t.assert.rejects(
    audit.append([/** @type {never} */ ({ type: "invented" })]),
    /AUDIT-SCHEMA/,
  );
  t.assert.equal(await files.readText("audit"), null);
  t.assert.equal(await audit.append([]), "duplicate");
});
