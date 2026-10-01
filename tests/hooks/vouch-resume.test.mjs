import operations from "../../core/registry/operations.json" with {
  type: "json",
};
import { deriveFixture } from "../helpers/fixtures.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { planned } from "../helpers/intent-review.mjs";
import { readJson } from "../helpers/registry.mjs";
import {
  asked,
  auditPath,
  card,
  decisions,
  defaulted,
  home,
  intent,
  jsonl,
} from "../helpers/resume.mjs";
import { runHook, sandbox } from "../helpers/runtime.mjs";

const hook = "vouch-record-session-start";
const labels = operations.labels.ja;

/** Captured SessionStart of each source, moved into the sandbox; `as` relabels the source.
 * @param {'claude'|'codex'} harness @param {string} source @param {string} root @param {string} [as] */
function captured(harness, source, root, as = source) {
  const path =
    harness === "claude"
      ? `tests/fixtures/harness/claude/2.1.283/linux/print/SessionStart.${source}.json`
      : `tests/fixtures/harness/codex/0.153.4/linux/exec/SessionStart.${source}.json`;
  return deriveFixture(readJson(path), { cwd: root, source: as });
}

/** @param {import('node:test').TestContext} t */
async function resumable(t) {
  const box = await sandbox(t);
  const fallback = asked("Q-2");
  await box.write(`${home}/intent.md`, planned());
  await box.write(`${home}/decisions.md`, decisions(card(), card("Q-2")));
  await box.write(
    auditPath,
    jsonl([asked("Q-1"), fallback, defaulted(fallback)]),
  );
  return box;
}

for (const [harness, sources] of Object.entries(operations.resume.sources)) {
  for (const source of sources.filter((name) => name !== "clear")) {
    test(`${harness} ${source} passes a read-only resume summary of the configured Intent`, async (t) => {
      const box = await resumable(t);
      const before = await box.read(auditPath);
      const result = runHook(
        hook,
        captured(/** @type {'claude'|'codex'} */ (harness), source, box.root),
        { root: box.root, intent },
      );
      const after = (await box.read(auditPath)).slice(before.length);
      t.plan(8);
      t.assert.deepEqual([result.exitCode, result.stderr], [0, ""]);
      t.assert.equal(result.stdout.startsWith(`${labels.summary}\n`), true);
      t.assert.match(result.stdout, /intent\.md: "draft"/);
      t.assert.match(
        result.stdout,
        new RegExp(`${labels.unanswered}: Q-1 \\(${asked("Q-1").id}`),
      );
      t.assert.match(result.stdout, new RegExp(`${labels.defaulted}: Q-2 → A`));
      t.assert.match(
        result.stdout,
        new RegExp(`${labels.missing}: acceptance, scope, units`),
      );
      t.assert.equal(
        result.stdout.length < 10000,
        true,
        "fits the harness context limit",
      );
      t.assert.deepEqual(
        after
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line).type),
        source === "startup" ? ["session.started"] : [],
        "only startup is recorded; resumes never write",
      );
    });
  }
}

test("Claude clear also receives the summary, Codex sources outside the registry do not", async (t) => {
  const box = await resumable(t);
  const options = { root: box.root, intent };
  const results = [
    runHook(hook, captured("claude", "resume", box.root, "clear"), options),
    runHook(hook, captured("codex", "resume", box.root, "clear"), options),
    runHook(hook, captured("claude", "resume", box.root, "fork"), options),
    runHook(hook, captured("claude", "resume", box.root), { root: box.root }),
  ];
  t.plan(2);
  t.assert.match(results[0]?.stdout ?? "", new RegExp(`^${labels.summary}`));
  t.assert.deepEqual(
    results
      .slice(1)
      .map((result) => [result.exitCode, result.stdout, result.stderr]),
    [
      [0, "", ""],
      [0, "", ""],
      [0, "", ""],
    ],
  );
});

test("a damaged audit log still yields a resume summary that refuses to claim nothing is unanswered", async (t) => {
  const box = await resumable(t);
  const before = `${await box.read(auditPath)}not json\n`;
  await box.write(auditPath, before);
  await box.write(`${home}/intent.md`, "---\nstatus: approved\n---\n# Plan\n");
  const result = runHook(hook, captured("claude", "compact", box.root), {
    root: box.root,
    intent,
  });
  t.plan(5);
  t.assert.deepEqual([result.exitCode, result.stderr], [0, ""]);
  t.assert.match(result.stdout, new RegExp(labels.partial));
  t.assert.match(result.stdout, new RegExp(labels.no_evidence));
  t.assert.match(result.stdout, /L4/);
  t.assert.equal(await box.read(auditPath), before);
});

test("startup replays record once and summarize every time without changing artifacts", async (t) => {
  const box = await resumable(t);
  const fixture = captured("codex", "startup", box.root);
  const first = runHook(hook, fixture, { root: box.root, intent });
  const log = await box.read(auditPath);
  const again = runHook(hook, fixture, {
    root: box.root,
    intent,
    instant: "2026-10-05T00:00:00Z",
  });
  t.plan(4);
  t.assert.match(first.stdout, new RegExp(`^${labels.summary}`));
  t.assert.match(again.stdout, new RegExp(`^${labels.summary}`));
  t.assert.equal(await box.read(auditPath), log);
  t.assert.equal(await box.read(`${home}/intent.md`), planned());
});
