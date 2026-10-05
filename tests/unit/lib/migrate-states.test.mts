import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { runMigrate } from "../../../core/hooks/lib/migrate.mjs";
import {
  digests,
  environment,
  git,
  home,
  ports,
  stateRecord,
  states,
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

const _check = (
  report: import("../../../core/hooks/lib/migration-contracts.mjs").MigrationReport,
  id: string,
) => report.checks.find((item) => item.id === id);

test("an explicit Intent name, the rules language and affirmation evidence shape the result", async (t) => {
  const files = v2Files("state-brownfield-feature.md");
  const { box: root, migrate } = await project(t, {
    ...files,
    "vouch/rules.md": "---\nlanguage: en\ncheckpoints: topic\n---\n# Rules\n",
  });
  const report = await migrate("apply", ...where, "250820-saved-search");
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
    const { box, migrate } = await project(t, stateRecord(state));
    const source = await digests(box.root, "aidlc");
    const report = await migrate("apply", ...where);
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
  await migrate("apply", ...where);
  await box.write(
    `${home}/intent.md`,
    "---\nstatus: approved\n---\n# Intent\n",
  );
  await box.write(`${home}/decisions.md`, "# Decisions\n");
  const report = await migrate("plan", ...where);
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
