import { link, readFile, rm } from "node:fs/promises";
import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { runMigrate } from "../../../core/hooks/lib/migrate.mjs";
import {
  digests,
  environment,
  git,
  ports,
  record,
  v2Files,
  where,
  writeTree,
} from "../../helpers/migrate.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

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

/** @param {{path:(path:string)=>string}} sandboxed @param {string} path */
function box(sandboxed, path) {
  return sandboxed.path(path);
}

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
