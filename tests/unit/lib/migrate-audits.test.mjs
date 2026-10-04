import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { runMigrate } from "../../../core/hooks/lib/migrate.mjs";
import {
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
    [`${record}/aidlc-state.md`]: /** @type {Buffer} */ (state),
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
