import { writeFile } from "node:fs/promises";
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
