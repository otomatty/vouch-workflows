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
  ports,
  record,
  v2Files,
  where,
  writeTree,
} from "../../helpers/migrate.mjs";
import { validator } from "../../helpers/registry.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

const _validateReport = validator("doctor-report");
const _validateAudit = validator("audit-event");

async function project(
  t: import("node:test").TestContext,
  files: Record<string, Buffer | string> = v2Files(),
) {
  const box = await sandbox(t, { git: false });
  await writeTree(box.root, files);
  const store = await createFileStore(box.root);
  const migrate = (...args: string[]) =>
    runMigrate(store, environment, git, ports(...args));
  return { box, store, migrate };
}

const check = (
  report: import("../../../core/hooks/lib/migration-contracts.mjs").MigrationReport,
  id: string,
) => report.checks.find((item) => item.id === id);

test("conflicting targets refuse the whole apply before any write", async (t) => {
  t.plan(8);
  const cases = [
    {
      name: "a different archive copy",
      prepare: (files: Record<string, string>) => ({
        ...files,
        [archive(`${record}/aidlc-state.md`)]: "changed\n",
      }),
    },
    {
      name: "another Intent with the same name",
      prepare: (files: Record<string, string>) => ({
        ...files,
        [`${home}/intent.md`]: "---\nstatus: draft\n---\n",
      }),
    },
    {
      name: "another Intent's audit",
      prepare: (files: Record<string, string>) => ({
        ...files,
        [`${home}/audit/events.jsonl`]: `${JSON.stringify({ id: "evt_other", v: 1, type: "session.started", ts: "2026-09-30T00:00:00Z", actor: "hook", session: "s" })}\n`,
      }),
    },
    {
      name: "a changed migration report",
      prepare: (files: Record<string, string>) => ({
        ...files,
        [`${home}/migration.md`]: "---\nstatus: draft\n---\n# edited\n",
      }),
    },
  ];
  for (const item of cases) {
    const { box, migrate } = await project(
      t,
      item.prepare(v2Files() as unknown as Record<string, string>) as Record<
        string,
        Buffer | string
      >,
    );
    const before = await digests(box.root, "vouch");
    const report = await migrate("apply", ...where);
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
  await migrate("apply", ...where);
  await writeFile(box.path(`${record}/notes/extra.md`), "# Changed\n");
  const report = await migrate("apply", ...where);
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
  const missing = await absent("apply", ...where);
  t.assert.deepEqual(
    [missing.ok, check(missing, "MIGRATE-SOURCE")?.ok],
    [false, false],
  );
  const { [`${record}/aidlc-state.md`]: _, ...stateless } = files;
  const { box: noState, migrate: withoutState } = await project(t, stateless);
  const noStateReport = await withoutState("apply", ...where);
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
  const corruptedReport = await corrupted("apply", ...where);
  t.assert.deepEqual(
    [corruptedReport.ok, check(corruptedReport, "MIGRATE-STATE")?.detail],
    [false, "no stage checkboxes"],
  );
  const { box: linked, migrate: withLink } = await project(t);
  await link(
    box(linked, `${record}/notes/extra.md`),
    box(linked, `${record}/notes/hard.md`),
  );
  const linkReport = await withLink("apply", ...where);
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
  const timelessReport = await timeless("apply", ...where);
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
  const directoryReport = await withDirectoryState("plan", ...where);
  t.assert.equal(check(directoryReport, "MIGRATE-STATE")?.ok, false);
  const usage = await absent("migrate", ...where);
  t.assert.deepEqual(
    [usage.ok, usage.checks.map((item) => item.id)],
    [false, ["MIGRATE-ARGS"]],
  );
  const badIntent = await absent("plan", ...where, "Bad Name");
  t.assert.equal(check(badIntent, "MIGRATE-ARGS")?.ok, false);
});

function box(sandboxed: { path: (path: string) => string }, path: string) {
  return sandboxed.path(path);
}

test("an audit shard that is not UTF-8 is named instead of being read as empty", async (t) => {
  const { migrate } = await project(t, {
    ...v2Files(),
    [`${record}/audit/binary.md`]: Buffer.from([0xff, 0xfe]),
  });
  const report = await migrate("plan", ...where);
  t.plan(2);
  t.assert.equal(report.ok, false);
  t.assert.equal(
    check(report, "MIGRATE-AUDIT")?.detail,
    `${record}/audit/binary.md: invalid UTF-8`,
  );
});

test("an audit shard without records is named instead of counted as an empty audit", async (t) => {
  const { migrate } = await project(t, {
    ...v2Files(),
    [`${record}/audit/empty.md`]: "# AI-DLC Audit Log\n",
  });
  const report = await migrate("plan", ...where);
  t.plan(2);
  t.assert.equal(report.ok, false);
  t.assert.equal(
    check(report, "MIGRATE-AUDIT")?.detail,
    `${record}/audit/empty.md: no records`,
  );
});

test("any Intent document in a folder without a report belongs to another Intent", async (t) => {
  const { [`${record}/aidlc-state.md`]: state } = v2Files();
  const { box, migrate } = await project(t, {
    [`${record}/aidlc-state.md`]: state as Buffer,
    [`${home}/design.md`]: "---\nstatus: draft\n---\n",
    [`${home}/review.md`]: "# Review\n",
  });
  const report = await migrate("apply", ...where);
  t.plan(3);
  t.assert.deepEqual(
    report.migration?.artifacts.map((item) => item.path),
    [`${home}/intent.md`, `${home}/decisions.md`],
    "the record itself names neither design.md nor review.md",
  );
  t.assert.match(
    check(report, "MIGRATE-TARGET")?.detail ?? "",
    /belongs to another Intent: vouch\/intents\/250615-widget\/design\.md, vouch\/intents\/250615-widget\/review\.md/,
  );
  t.assert.deepEqual(
    Object.keys(await digests(box.root, "vouch")),
    [`${home}/design.md`, `${home}/review.md`],
    "nothing is written",
  );
});
