import { test } from "node:test";
import {
  createAuditStore,
  createIntentAuditStore,
  findEvent,
  listEvents,
  scanAudit,
} from "../../../core/hooks/lib/audit.mjs";
import { readJson } from "../../helpers/registry.mjs";
import { memoryFiles } from "../../helpers/runtime.mjs";

/** @returns {import('../../../core/hooks/lib/contracts.mjs').AuditEvent} */
function event() {
  return readJson("tests/fixtures/audit/hook.check.jsonl");
}

test("event lookup rejects a missing reader and preserves matching records", async (t) => {
  t.plan(3);
  await t.assert.rejects(findEvent(undefined, "id"), /AUDIT-MISSING/);
  await t.assert.rejects(
    findEvent({ append: async () => "duplicate" }, "id"),
    /AUDIT-MISSING/,
  );
  const sample = event();
  t.assert.deepEqual(
    await findEvent(
      createAuditStore(
        memoryFiles({ audit: `${JSON.stringify(sample)}\n` }),
        "audit",
      ),
      sample.id,
    ),
    sample,
  );
});

test("audit lookup validates the whole log before returning an event", async (t) => {
  const sample = event();
  const files = memoryFiles({ audit: `${JSON.stringify(sample)}\n` });
  const audit = createAuditStore(files, "audit");
  t.plan(5);
  t.assert.deepEqual(await audit.find?.(sample.id), sample);
  t.assert.equal(await audit.find?.("absent"), undefined);
  files.data.set("audit", `${JSON.stringify(sample)}\ninvalid\n`);
  await t.assert.rejects(audit.find(sample.id), /AUDIT-CORRUPT/);
  files.data.set(
    "audit",
    `${JSON.stringify(sample)}\n${JSON.stringify(sample)}\n`,
  );
  await t.assert.rejects(audit.find(sample.id), /AUDIT-CORRUPT/);
  files.data.delete("audit");
  t.assert.equal(await audit.find?.("absent"), undefined);
});

test("intent audit scope rejects paths and uses only the configured intent", async (t) => {
  const files = memoryFiles();
  t.plan(7);
  for (const scope of ["", "../x", "a/b", "A", "a".repeat(129), "name:stream"])
    t.assert.throws(() => createIntentAuditStore(files, scope), /AUDIT-SCOPE/);
  await createIntentAuditStore(files, "intent-1").append([event()]);
  t.assert.deepEqual(
    [...files.data.keys()],
    ["vouch/intents/intent-1/audit/events.jsonl"],
  );
});

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

test("audit snapshots a validated batch before an asynchronous file update", async (t) => {
  const sample = event();
  const original = structuredClone(sample);
  const files = memoryFiles();
  const audit = createAuditStore(
    {
      ...files,
      updateText: async (path, update) => {
        await Promise.resolve();
        return files.updateText(path, update);
      },
    },
    "audit",
  );
  const pending = audit.append([sample]);
  sample.actor = "model";
  t.plan(2);
  t.assert.equal(await pending, "appended");
  t.assert.deepEqual(
    JSON.parse((await files.readText("audit")) ?? "null"),
    original,
  );
});

test("mutating a lookup result cannot poison later reads or duplicate detection", async (t) => {
  const sample = event();
  sample.harness = "claude";
  sample.tokens = { in: 1, out: 2 };
  const text = `${JSON.stringify(sample)}\n`;
  const files = memoryFiles({ audit: text });
  const audit = createAuditStore(files, "audit");
  const found = await audit.find(sample.id);
  if (!found?.tokens) throw new Error("expected the complete record");
  found.actor = "model";
  found.tokens.in = 999;
  t.plan(3);
  t.assert.deepEqual(await audit.find(sample.id), sample);
  t.assert.equal(await audit.append([sample]), "duplicate");
  t.assert.equal(await files.readText("audit"), text);
});

test("audit rereads same-length external changes before lookup and locked append", async (t) => {
  const sample = event();
  const original = `${JSON.stringify(sample)}\n`;
  const external = { ...sample, ts: sample.ts.replace(/^\d{4}/, "2099") };
  const changed = `${JSON.stringify(external)}\n`;
  const files = memoryFiles({ audit: original });
  const audit = createAuditStore(files, "audit");
  await audit.find(sample.id);
  files.data.set("audit", changed);
  t.plan(5);
  t.assert.equal(changed.length, original.length);
  t.assert.deepEqual(await audit.find(sample.id), external);
  files.data.set("audit", original);
  await t.assert.rejects(audit.append([external]), /AUDIT-CONFLICT/);
  t.assert.equal(await files.readText("audit"), original);
  t.assert.deepEqual(await audit.find(sample.id), sample);
});

test("a validated log never hides later corruption or deletion", async (t) => {
  const sample = event();
  const text = `${JSON.stringify(sample)}\n`;
  const files = memoryFiles({ audit: text });
  const audit = createAuditStore(files, "audit");
  await audit.find(sample.id);
  files.data.set("audit", `${text}broken\n`);
  t.plan(6);
  await t.assert.rejects(audit.append([sample]), /AUDIT-CORRUPT/);
  await t.assert.rejects(audit.find(sample.id), /AUDIT-CORRUPT/);
  t.assert.equal(await files.readText("audit"), `${text}broken\n`);
  files.data.delete("audit");
  t.assert.equal(await audit.find(sample.id), undefined);
  t.assert.equal(await audit.append([sample]), "appended");
  t.assert.equal(await files.readText("audit"), text);
});

test("a rejected batch cannot leak uncommitted rows into a validated snapshot", async (t) => {
  const sample = event();
  const text = `${JSON.stringify(sample)}\n`;
  const files = memoryFiles({ audit: text });
  const audit = createAuditStore(files, "audit");
  await audit.find(sample.id);
  const next = { ...sample, id: "not-yet-persisted" };
  t.plan(5);
  await t.assert.rejects(
    audit.append([next, { ...sample, duration_ms: 999 }]),
    /AUDIT-CONFLICT/,
  );
  t.assert.equal(await audit.find(next.id), undefined);
  t.assert.equal(await files.readText("audit"), text);
  t.assert.equal(await audit.append([next]), "appended");
  t.assert.equal(
    await files.readText("audit"),
    `${text}${JSON.stringify(next)}\n`,
  );
});

test("audit lists every validated record in file order as detached copies", async (t) => {
  const first = event();
  const second = { ...event(), id: "second-check" };
  const files = memoryFiles({
    audit: `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
  });
  const audit = createAuditStore(files, "audit");
  t.plan(7);
  await t.assert.rejects(listEvents(undefined), /AUDIT-MISSING/);
  await t.assert.rejects(
    listEvents({ append: async () => "duplicate" }),
    /AUDIT-MISSING/,
  );
  const listed = await listEvents(audit);
  t.assert.deepEqual(listed, [first, second]);
  /** @type {Record<string,unknown>} */ (listed[0]).id = "mutated";
  t.assert.deepEqual(await audit.list(), [first, second]);
  files.data.set("audit", `${JSON.stringify(first)}\ninvalid\n`);
  await t.assert.rejects(audit.list(), /AUDIT-CORRUPT/);
  files.data.delete("audit");
  t.assert.deepEqual(await audit.list(), []);
  files.data.set("audit", "");
  t.assert.deepEqual(await audit.list(), []);
});

test("the audit scan keeps every readable record and names damaged lines and repeated IDs", (t) => {
  const record = /** @type {Record<string,unknown>} */ ({ ...event() });
  delete record.synthetic;
  const other = { ...record, id: "other" };
  t.plan(5);
  t.assert.deepEqual(scanAudit(null), {
    events: [],
    invalid: [],
    duplicates: [],
  });
  t.assert.deepEqual(scanAudit(""), {
    events: [],
    invalid: [],
    duplicates: [],
  });
  t.assert.deepEqual(
    scanAudit(
      `${JSON.stringify(record)}\nnot json\n{"id":"x"}\n\n${JSON.stringify(record)}\n${JSON.stringify(other)}\n`,
    ),
    { events: [record, other], invalid: [2, 3, 4], duplicates: [record.id] },
  );
  t.assert.deepEqual(scanAudit(JSON.stringify(record)), {
    events: [],
    invalid: [1],
    duplicates: [],
  });
  t.assert.deepEqual(
    scanAudit(`${JSON.stringify(record)}\r\n`).invalid,
    [],
    "like the store, JSON whitespace around a record is accepted",
  );
});
