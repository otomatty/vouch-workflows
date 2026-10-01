import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { deriveFixture } from "../helpers/fixtures.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import {
  archive,
  digests,
  home,
  intent,
  record,
  v2Files,
  writeTree,
} from "../helpers/migrate.mjs";
import { packageRun } from "../helpers/packaging.mjs";
import { readJson, validator } from "../helpers/registry.mjs";
import { sandbox } from "../helpers/runtime.mjs";
import { toolFixture } from "../helpers/write-guard.mjs";

// Installed migrate command and approval: docs/development/migrate.md.
const captures = {
  claude: "tests/fixtures/harness/claude/2.1.283/linux/print",
  codex: "tests/fixtures/harness/codex/0.153.4/linux/exec",
};

for (const harness of /** @type {const} */ (["claude", "codex"])) {
  test(`installed ${harness} migrate plans, applies and is completed only by the person's approval`, async (t) => {
    t.plan(10);
    const box = await sandbox(t);
    const root = box.path("日本語 project $ apostrophe'");
    t.assert.equal(packageRun(["--out", box.path("dist")]).status, 0);
    await cp(box.path(`dist/${harness}`), root, { recursive: true });
    execFileSync("git", ["init", "-q", "--initial-branch=main", root], {
      windowsHide: true,
    });
    await writeTree(root, v2Files());
    const env = {
      ...process.env,
      VOUCH_PROJECT_ROOT: root,
      VOUCH_HARNESS: harness,
      VOUCH_INTENT: intent,
    };
    const entry = `.${harness}/hooks/vouch-migrate.mjs`;
    /** @param {string} file @param {string[]} args @param {string} [input] */
    const node = (file, args, input) =>
      spawnSync(process.execPath, [join(root, file), ...args], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 8000,
        env,
        ...(input === undefined ? {} : { input }),
      });
    const guard = node(
      `.${harness}/hooks/vouch-guard-writes.mjs`,
      [],
      JSON.stringify(
        toolFixture(harness, "Bash", root, {
          command: `node ${entry} apply ${record}`,
        }).payload,
      ),
    );
    const source = await digests(root, "aidlc");
    const plan = node(entry, ["plan", record]);
    const apply = node(entry, ["apply", record]);
    const report = JSON.parse(apply.stdout);
    const brief = await readFile(join(root, home, "migration.md"));
    const digest = createHash("sha256").update(brief).digest("hex");
    const approve = node(
      `.${harness}/hooks/vouch-record-intent-review.mjs`,
      [],
      JSON.stringify(
        deriveFixture(readJson(`${captures[harness]}/UserPromptSubmit.json`), {
          cwd: root,
          prompt: `vouch migrate approve ${digest}`,
        }).payload,
      ),
    );
    const rows = (
      await readFile(join(root, home, "audit/events.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    t.assert.equal(guard.status, 0, guard.stderr);
    t.assert.deepEqual(
      [plan.status, apply.status],
      [0, 0],
      `${plan.stdout}${apply.stdout}`,
    );
    t.assert.equal(validator("doctor-report")(report), true);
    t.assert.deepEqual(report.migration.writes, {
      archived: 26,
      unchanged: 0,
      audit: "appended",
      brief: "written",
    });
    t.assert.deepEqual(await digests(root, "aidlc"), source);
    t.assert.deepEqual(
      Object.keys(await digests(root, "vouch/archive")),
      Object.keys(source).map(archive),
    );
    t.assert.deepEqual(
      [approve.status, approve.stderr.split(":")[0]],
      [2, "VOUCH-MIGRATE-RECORDED"],
    );
    t.assert.equal(rows.length, 14, "13 migrated records and the approval");
    t.assert.deepEqual(
      [rows.at(-1).type, rows.at(-1).actor, rows.at(-1).files_migrated],
      ["migration.completed", "human", 26],
    );
  });
}
