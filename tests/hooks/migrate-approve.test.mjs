import { createHash } from "node:crypto";
import { deriveFixture } from "../helpers/fixtures.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { home, intent } from "../helpers/migrate.mjs";
import { readJson, validator } from "../helpers/registry.mjs";
import { runHook, sandbox } from "../helpers/runtime.mjs";

// The installed UserPromptSubmit entry records a person's migration approval and withholds the prompt.
const captures = {
  claude: "tests/fixtures/harness/claude/2.1.283/linux/print",
  codex: "tests/fixtures/harness/codex/0.153.4/linux/exec",
};
const brief = `---\nstatus: draft\nsource: aidlc/spaces/default/intents/${intent}\nintent: ${intent}\nfiles: 3\n---\n\n# 移行レポート: ${intent}\n`;
const digest = createHash("sha256").update(brief).digest("hex");

for (const harness of /** @type {const} */ (["claude", "codex"])) {
  test(`${harness} records migration.completed only for the current report digest`, async (t) => {
    const box = await sandbox(t);
    await box.write(`${home}/migration.md`, brief);
    /** @param {string} prompt */
    const submit = (prompt) =>
      runHook(
        "vouch-record-intent-review",
        deriveFixture(readJson(`${captures[harness]}/UserPromptSubmit.json`), {
          cwd: box.root,
          prompt,
        }),
        { root: box.root, intent },
      );
    const stale = submit(`vouch migrate approve ${"0".repeat(64)}`);
    const approved = submit(`vouch migrate approve ${digest}`);
    const rows = (await box.read(`${home}/audit/events.jsonl`))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    t.plan(5);
    t.assert.deepEqual(
      [stale.exitCode, stale.stderr.split(":")[0]],
      [2, "VOUCH-MIGRATE-CHANGED"],
    );
    t.assert.deepEqual(
      [approved.exitCode, approved.stderr.split(":")[0]],
      [2, "VOUCH-MIGRATE-RECORDED"],
    );
    t.assert.equal(rows.length, 1);
    t.assert.equal(validator("audit-event")(rows[0]), true);
    t.assert.deepEqual(
      [
        rows[0].type,
        rows[0].actor,
        rows[0].harness,
        rows[0].revision.sha256,
        rows[0].files_migrated,
      ],
      ["migration.completed", "human", harness, digest, 3],
    );
  });
}
