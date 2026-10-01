import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { runMigrate } from "../../../core/hooks/lib/migrate.mjs";
import {
  archive,
  digests,
  environment,
  git,
  home,
  intent,
  ports,
  record,
  v2Files,
  where,
  writeTree,
} from "../../helpers/migrate.mjs";
import { validator } from "../../helpers/registry.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

const validateReport = validator("doctor-report");
const validateAudit = validator("audit-event");

/** @param {import('node:test').TestContext} t @param {Record<string,Buffer|string>} [files] */
async function project(t, files = v2Files()) {
  const box = await sandbox(t, { git: false });
  await writeTree(box.root, files);
  const store = await createFileStore(box.root);
  /** @param {...string} args */
  const migrate = (...args) =>
    runMigrate(store, environment, git, ports(...args));
  return { box, store, migrate };
}

/** @param {import('../../../core/hooks/lib/migration-contracts.mjs').MigrationReport} report @param {string} id */
const check = (report, id) => report.checks.find((item) => item.id === id);

test("plan reads every source file, routes it and changes nothing", async (t) => {
  const { box, migrate } = await project(t);
  const before = await digests(box.root, ".");
  const report = await migrate("plan", ...where);
  const plan = report.migration;
  t.plan(12);
  t.assert.equal(
    validateReport(report),
    true,
    JSON.stringify(validateReport.errors),
  );
  t.assert.equal(report.ok, true, JSON.stringify(report.checks));
  t.assert.deepEqual(await digests(box.root, "."), before, "plan never writes");
  t.assert.equal(plan?.files.length, 26);
  t.assert.deepEqual(
    plan?.files
      .filter((file) => file.to.length === 0)
      .map((file) => [file.origin, file.note]),
    [
      ["inception/requirements-analysis/memory.md", "diary"],
      ["notes/extra.md", "unmatched"],
      ["operation/deployment-pipeline/cd-config.md", "operation"],
      ["runtime-graph.json", "transient"],
      ["memory/org.md", "default"],
      ["memory/phases/inception.md", "default"],
      ["memory/team.md", "unaffirmed"],
    ],
  );
  t.assert.deepEqual(
    plan?.files.find(
      (file) => file.origin === "ideation/rough-mockups/wireframe.png",
    ),
    {
      path: `${record}/ideation/rough-mockups/wireframe.png`,
      origin: "ideation/rough-mockups/wireframe.png",
      bytes: 9,
      sha256: createHash("sha256")
        .update(
          v2Files()[`${record}/ideation/rough-mockups/wireframe.png`] ?? "",
        )
        .digest("hex"),
      archive: archive(`${record}/ideation/rough-mockups/wireframe.png`),
      to: ["intent.md#analysis", "vouch/knowledge/background/"],
    },
  );
  t.assert.deepEqual(
    [
      plan?.progress.intent.state,
      plan?.progress.design.state,
      plan?.progress.build.state,
      plan?.progress.verify.state,
      plan?.units,
    ],
    [
      "completed",
      "active",
      "pending",
      "absent",
      ["widget-cart", "widget-checkout"],
    ],
  );
  t.assert.deepEqual(
    [
      plan?.audit.blocks,
      plan?.audit.converted,
      plan?.audit.legacy,
      plan?.audit.estimated,
      plan?.decisions.length,
    ],
    [13, 4, 9, 2, 1],
  );
  t.assert.deepEqual(plan?.codekb, [
    {
      repo: "widget-app",
      files: 5,
      scanned: "2026-07-27",
      commit: "fixture (no repository)",
      verifiable: false,
    },
  ]);
  t.assert.deepEqual(plan?.artifacts, [
    { path: `${home}/intent.md`, present: false, status: null },
    { path: `${home}/design.md`, present: false, status: null },
    { path: `${home}/build-log.md`, present: false, status: null },
    { path: `${home}/review.md`, present: false, status: null },
    { path: `${home}/decisions.md`, present: false, status: null },
  ]);
  t.assert.deepEqual(
    [
      plan?.intent,
      plan?.language,
      plan?.affirmation,
      plan?.brief,
      plan?.writes,
    ],
    [
      intent,
      "ja",
      null,
      { path: `${home}/migration.md`, sha256: null },
      undefined,
    ],
  );
  t.assert.deepEqual(
    report.checks.map((item) => [item.id, item.ok]),
    [
      ["MIGRATE-ARGS", true],
      ["MIGRATE-SOURCE", true],
      ["MIGRATE-FILES", true],
      ["MIGRATE-STATE", true],
      ["MIGRATE-AUDIT", true],
      ["MIGRATE-TARGET", true],
    ],
  );
});

test("apply archives byte for byte, converts the audit, writes the Brief and leaves the source unchanged", async (t) => {
  const { box, migrate } = await project(t);
  const source = await digests(box.root, "aidlc");
  const report = await migrate("apply", ...where);
  const records = (await box.read(`${home}/audit/events.jsonl`))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const archived = await digests(box.root, "vouch/archive/aidlc-v2");
  const brief = await box.read(`${home}/migration.md`);
  t.plan(11);
  t.assert.equal(report.ok, true, JSON.stringify(report.checks));
  t.assert.equal(
    validateReport(report),
    true,
    JSON.stringify(validateReport.errors),
  );
  t.assert.deepEqual(report.migration?.writes, {
    archived: 26,
    unchanged: 0,
    audit: "appended",
    brief: "written",
  });
  t.assert.deepEqual(
    await digests(box.root, "aidlc"),
    source,
    "the source is unchanged",
  );
  t.assert.deepEqual(
    archived,
    Object.fromEntries(
      Object.entries(source).map(([path, sha]) => [archive(path), sha]),
    ),
    "the archive holds every source file with the same bytes",
  );
  t.assert.deepEqual(
    await readFile(
      box.path(archive(`${record}/ideation/rough-mockups/wireframe.png`)),
    ),
    await readFile(box.path(`${record}/ideation/rough-mockups/wireframe.png`)),
  );
  t.assert.equal(records.length, 13, "every audit block is one record");
  t.assert.equal(
    records.every((event) => validateAudit(event)),
    true,
  );
  t.assert.equal(
    records.every(
      (event) =>
        event.raw &&
        event.source_path &&
        event.original_type &&
        event.actor === "hook",
    ),
    true,
    "original text and origin are kept on every record",
  );
  t.assert.match(
    brief,
    /^---\nstatus: draft\nsource: aidlc\/spaces\/default\/intents\/250615-widget\nintent: 250615-widget\nfiles: 26\n---\n/,
  );
  t.assert.equal(check(report, "MIGRATE-VERIFY")?.ok, true);
});

test("a rerun of a completed apply writes nothing and reports every file as unchanged", async (t) => {
  const { box, migrate } = await project(t);
  const first = await migrate("apply", ...where);
  const after = await digests(box.root, ".");
  const second = await migrate("apply", ...where);
  t.plan(4);
  t.assert.equal(second.ok, true, JSON.stringify(second.checks));
  t.assert.deepEqual(second.migration?.writes, {
    archived: 0,
    unchanged: 26,
    audit: "duplicate",
    brief: "unchanged",
  });
  t.assert.deepEqual(await digests(box.root, "."), after);
  t.assert.equal(second.migration?.brief.sha256, first.migration?.brief.sha256);
});

test("a partial failure is completed by the next apply without duplicating anything", async (t) => {
  const { box, store } = await project(t);
  t.plan(7);
  let calls = 0;
  /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').FileStore} */
  const failing = {
    ...store,
    async createBytes(path, bytes) {
      if (++calls === 4) throw new Error("FS-DISK: injected");
      return store.createBytes(path, bytes);
    },
  };
  await t.assert.rejects(
    runMigrate(failing, environment, git, ports("apply", ...where)),
    /FS-DISK/,
  );
  const partial = await digests(box.root, "vouch");
  const auditFailing = {
    ...store,
    /** @type {typeof store.updateText} */
    async updateText(path, update) {
      if (path.endsWith("events.jsonl")) throw new Error("FS-DISK: audit");
      return store.updateText(path, update);
    },
  };
  await t.assert.rejects(
    runMigrate(auditFailing, environment, git, ports("apply", ...where)),
    /FS-DISK: audit/,
  );
  const resumed = await runMigrate(
    store,
    environment,
    git,
    ports("apply", ...where),
  );
  const records = (await box.read(`${home}/audit/events.jsonl`))
    .trim()
    .split("\n");
  t.assert.equal(
    Object.keys(partial).length,
    3,
    "three files were written before the failure",
  );
  t.assert.equal(resumed.ok, true, JSON.stringify(resumed.checks));
  t.assert.deepEqual(resumed.migration?.writes, {
    archived: 0,
    unchanged: 26,
    audit: "appended",
    brief: "written",
  });
  t.assert.equal(records.length, 13);
  t.assert.equal(new Set(records.map((line) => JSON.parse(line).id)).size, 13);
});
