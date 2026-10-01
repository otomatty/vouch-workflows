import { createHash } from "node:crypto";
import { link, readFile, rm, writeFile } from "node:fs/promises";
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
  states,
  v2Files,
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
  const report = await migrate("plan", record);
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
      ["memory/org.md", "default"],
      ["memory/phases/inception.md", "default"],
      ["memory/team.md", "unaffirmed"],
      ["inception/requirements-analysis/memory.md", "diary"],
      ["notes/extra.md", "unmatched"],
      ["operation/deployment-pipeline/cd-config.md", "operation"],
      ["runtime-graph.json", "transient"],
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
  const report = await migrate("apply", record);
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
  const first = await migrate("apply", record);
  const after = await digests(box.root, ".");
  const second = await migrate("apply", record);
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
    runMigrate(failing, environment, git, ports("apply", record)),
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
    runMigrate(auditFailing, environment, git, ports("apply", record)),
    /FS-DISK: audit/,
  );
  const resumed = await runMigrate(
    store,
    environment,
    git,
    ports("apply", record),
  );
  const records = (await box.read(`${home}/audit/events.jsonl`))
    .trim()
    .split("\n");
  t.plan(5);
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

test("conflicting targets refuse the whole apply before any write", async (t) => {
  t.plan(8);
  const cases = [
    {
      name: "a different archive copy",
      prepare: (/** @type {Record<string,string>} */ files) => ({
        ...files,
        [archive(`${record}/aidlc-state.md`)]: "changed\n",
      }),
    },
    {
      name: "another Intent with the same name",
      prepare: (/** @type {Record<string,string>} */ files) => ({
        ...files,
        [`${home}/intent.md`]: "---\nstatus: draft\n---\n",
      }),
    },
    {
      name: "another Intent's audit",
      prepare: (/** @type {Record<string,string>} */ files) => ({
        ...files,
        [`${home}/audit/events.jsonl`]: `${JSON.stringify({ id: "evt_other", v: 1, type: "session.started", ts: "2026-09-30T00:00:00Z", actor: "hook", session: "s" })}\n`,
      }),
    },
    {
      name: "a changed migration report",
      prepare: (/** @type {Record<string,string>} */ files) => ({
        ...files,
        [`${home}/migration.md`]: "---\nstatus: draft\n---\n# edited\n",
      }),
    },
  ];
  for (const item of cases) {
    const { box, migrate } = await project(
      t,
      /** @type {Record<string,Buffer|string>} */ (
        item.prepare(
          /** @type {Record<string,string>} */ (
            /** @type {unknown} */ (v2Files())
          ),
        )
      ),
    );
    const before = await digests(box.root, "vouch");
    const report = await migrate("apply", record);
    t.assert.deepEqual(
      [report.ok, check(report, "MIGRATE-TARGET")?.ok],
      [false, false],
      item.name,
    );
    t.assert.deepEqual(
      await digests(box.root, "vouch"),
      before,
      `${item.name}: nothing written`,
    );
  }
});

test("a source changed after its migration conflicts with the archive", async (t) => {
  const { box, migrate } = await project(t);
  await migrate("apply", record);
  await writeFile(box.path(`${record}/notes/extra.md`), "# Changed\n");
  const report = await migrate("apply", record);
  t.plan(2);
  t.assert.equal(report.ok, false);
  t.assert.match(
    check(report, "MIGRATE-TARGET")?.detail ?? "",
    /vouch\/archive\/aidlc-v2\/aidlc\/spaces\/default\/intents\/250615-widget\/notes\/extra\.md/,
  );
});

test("missing, corrupted, linked and timeless sources are refused and named", async (t) => {
  t.plan(10);
  const files = v2Files();
  const { migrate: absent } = await project(t, {});
  const missing = await absent("apply", record);
  t.assert.deepEqual(
    [missing.ok, check(missing, "MIGRATE-SOURCE")?.ok],
    [false, false],
  );
  const { [`${record}/aidlc-state.md`]: _, ...stateless } = files;
  const { box: noState, migrate: withoutState } = await project(t, stateless);
  const noStateReport = await withoutState("apply", record);
  t.assert.deepEqual(
    [noStateReport.ok, check(noStateReport, "MIGRATE-STATE")?.detail],
    [false, "aidlc-state.md is missing"],
  );
  t.assert.deepEqual(
    await digests(noState.root, "vouch"),
    {},
    "nothing is written",
  );
  const { migrate: corrupted } = await project(t, {
    ...files,
    [`${record}/aidlc-state.md`]: await readFile(
      "docs/aidlc-v2-reference/tests/fixtures/state-corrupted.md",
    ),
  });
  const corruptedReport = await corrupted("apply", record);
  t.assert.deepEqual(
    [corruptedReport.ok, check(corruptedReport, "MIGRATE-STATE")?.detail],
    [false, "no stage checkboxes"],
  );
  const { box: linked, migrate: withLink } = await project(t);
  await link(
    box(linked, `${record}/notes/extra.md`),
    box(linked, `${record}/notes/hard.md`),
  );
  const linkReport = await withLink("apply", record);
  t.assert.deepEqual(
    [linkReport.ok, check(linkReport, "MIGRATE-FILES")?.ok],
    [false, false],
  );
  t.assert.match(
    check(linkReport, "MIGRATE-FILES")?.detail ?? "",
    /notes\/extra\.md|notes\/hard\.md/,
  );
  const { migrate: timeless } = await project(t, {
    ...files,
    [`${record}/audit/broken.md`]: "## A\n**Event**: SESSION_STARTED\n",
  });
  const timelessReport = await timeless("apply", record);
  t.assert.deepEqual(
    [timelessReport.ok, check(timelessReport, "MIGRATE-AUDIT")?.detail],
    [false, `${record}/audit/broken.md: no valid timestamp`],
  );
  const { box: unreadable, migrate: withDirectoryState } = await project(
    t,
    stateless,
  );
  await rm(unreadable.path(`${record}/aidlc-state.md`), { force: true });
  await writeTree(unreadable.root, {
    [`${record}/aidlc-state.md/inner.md`]: "x",
  });
  const directoryReport = await withDirectoryState("plan", record);
  t.assert.equal(check(directoryReport, "MIGRATE-STATE")?.ok, false);
  const usage = await absent("migrate", record);
  t.assert.deepEqual(
    [usage.ok, usage.checks.map((item) => item.id)],
    [false, ["MIGRATE-ARGS"]],
  );
  const badIntent = await absent("plan", record, "Bad Name");
  t.assert.equal(check(badIntent, "MIGRATE-ARGS")?.ok, false);
});

/** @param {{path:(path:string)=>string}} sandboxed @param {string} path */
function box(sandboxed, path) {
  return sandboxed.path(path);
}

test("an explicit Intent name, the rules language and affirmation evidence shape the result", async (t) => {
  const files = v2Files("state-brownfield-feature.md");
  const { box: root, migrate } = await project(t, {
    ...files,
    "vouch/rules.md": "---\nlanguage: en\ncheckpoints: topic\n---\n# Rules\n",
  });
  const report = await migrate("apply", record, "250820-saved-search");
  t.plan(5);
  t.assert.equal(report.ok, true, JSON.stringify(report.checks));
  t.assert.deepEqual(
    [
      report.migration?.intent,
      report.migration?.language,
      report.migration?.affirmation,
    ],
    [
      "250820-saved-search",
      "en",
      "aidlc-state.md: Practices Affirmed Timestamp 2025-08-20T09:30:00Z",
    ],
  );
  t.assert.deepEqual(
    report.migration?.files.find((file) => file.origin === "memory/team.md")
      ?.to,
    ["vouch/rules.md"],
  );
  t.assert.match(
    await root.read("vouch/intents/250820-saved-search/migration.md"),
    /^# Migration report: 250820-saved-search$/m,
  );
  t.assert.equal(report.migration?.progress.intent.state, "active");
});

test("each of the 15 state fixtures is applied, or refused only when its checkboxes are unreadable", async (t) => {
  t.plan(states.length * 2);
  for (const state of states) {
    const { box, migrate } = await project(t, v2Files(state));
    const source = await digests(box.root, "aidlc");
    const report = await migrate("apply", record);
    t.assert.equal(
      report.ok,
      state !== "state-corrupted.md",
      `${state}: ${JSON.stringify(report.checks)}`,
    );
    t.assert.deepEqual(
      await digests(box.root, "aidlc"),
      source,
      `${state}: source unchanged`,
    );
  }
});

test("the observed artifacts report presence and the raw status without interpreting it", async (t) => {
  const { box, migrate } = await project(t);
  await migrate("apply", record);
  await box.write(
    `${home}/intent.md`,
    "---\nstatus: approved\n---\n# Intent\n",
  );
  await box.write(`${home}/decisions.md`, "# Decisions\n");
  const report = await migrate("plan", record);
  t.plan(2);
  t.assert.equal(report.ok, true, JSON.stringify(report.checks));
  t.assert.deepEqual(
    report.migration?.artifacts.filter((item) => item.present),
    [
      { path: `${home}/intent.md`, present: true, status: "approved" },
      { path: `${home}/decisions.md`, present: true, status: null },
    ],
  );
});
