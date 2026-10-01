import { deriveFixture } from "../helpers/fixtures.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { planned } from "../helpers/intent-review.mjs";
import { readJson, validator } from "../helpers/registry.mjs";
import {
  asked,
  auditPath,
  card,
  decisions,
  home,
  intent,
  jsonl,
} from "../helpers/resume.mjs";
import { runHook, sandbox } from "../helpers/runtime.mjs";

// The captured prompt and Stop of one turn share prompt_id (Claude) or turn_id (Codex).
const captures = {
  claude: "tests/fixtures/harness/claude/2.1.283/linux/print",
  codex: "tests/fixtures/harness/codex/0.153.4/linux/exec",
};

/** @param {'claude'|'codex'} harness @param {string} root @param {string} prompt */
const submit = (harness, root, prompt) =>
  deriveFixture(readJson(`${captures[harness]}/UserPromptSubmit.json`), {
    cwd: root,
    prompt,
  });
/** @param {'claude'|'codex'} harness @param {string} root */
const stop = (harness, root) =>
  deriveFixture(readJson(`${captures[harness]}/Stop.json`), { cwd: root });

/** @param {{read:(path:string)=>Promise<string>}} box */
const rows = async (box) =>
  (await box.read(auditPath))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

for (const harness of /** @type {const} */ (["claude", "codex"])) {
  test(`${harness} records an ask on submission and its answer at the Stop of the same turn`, async (t) => {
    const box = await sandbox(t);
    const prefix = harness === "claude" ? "/vouch ask" : "$vouch ask";
    const question = runHook(
      "vouch-record-intent-review",
      submit(harness, box.root, `${prefix} Why is the cache rebuilt?`),
      { root: box.root, intent },
    );
    const answer = runHook(
      "vouch-record-aside-answer",
      stop(harness, box.root),
      {
        root: box.root,
        intent,
        instant: "2026-09-27T00:00:01.500Z",
      },
    );
    const replay = runHook(
      "vouch-record-aside-answer",
      stop(harness, box.root),
      {
        root: box.root,
        intent,
        instant: "2026-09-28T00:00:00Z",
      },
    );
    const records = await rows(box);
    const validate = validator("audit-event");
    const captured = readJson(`${captures[harness]}/Stop.json`).payload;
    t.plan(6);
    t.assert.deepEqual(
      [question, answer, replay].map((r) => [r.exitCode, r.stdout, r.stderr]),
      [
        [0, "", ""],
        [0, "", ""],
        [0, "", ""],
      ],
    );
    t.assert.deepEqual(
      records.map((r) => [r.type, r.actor, r.harness]),
      [
        ["aside.asked", "human", harness],
        ["aside.answered", "model", harness],
      ],
    );
    t.assert.equal(
      records.every((r) => validate(r)),
      true,
    );
    t.assert.equal(records[0].question, "Why is the cache rebuilt?");
    t.assert.deepEqual(
      [records[1].parent, records[1].duration_ms, records[1].answer],
      [records[0].id, 1500, captured.last_assistant_message],
    );
    t.assert.equal(records[1].session, captured.session_id);
  });
}

test("Stop without an ask of that turn, or without a configured Intent, records nothing", async (t) => {
  const box = await sandbox(t);
  const results = [
    runHook("vouch-record-aside-answer", stop("claude", box.root), {
      root: box.root,
      intent,
    }),
    runHook("vouch-record-aside-answer", stop("codex", box.root), {
      root: box.root,
    }),
    runHook(
      "vouch-record-intent-review",
      submit("claude", box.root, "/vouch ask anything"),
      { root: box.root },
    ),
  ];
  t.plan(2);
  t.assert.deepEqual(
    results.map((r) => [r.exitCode, r.stdout, r.stderr]),
    [
      [0, "", ""],
      [0, "", ""],
      [0, "", ""],
    ],
  );
  await t.assert.rejects(box.read(auditPath), { code: "ENOENT" });
});

for (const harness of /** @type {const} */ (["claude", "codex"])) {
  test(`${harness} records a person's explicit answer without confirming or approving anything`, async (t) => {
    const box = await sandbox(t);
    const question = asked("Q-1");
    await box.write(`${home}/intent.md`, planned());
    await box.write(`${home}/decisions.md`, decisions(card()));
    await box.write(auditPath, jsonl([question]));
    const result = runHook(
      "vouch-record-intent-review",
      submit(harness, box.root, "vouch answer Q-1 B"),
      { root: box.root, intent, instant: "2026-09-30T00:00:09Z" },
    );
    const refused = runHook(
      "vouch-record-intent-review",
      submit(harness, box.root, "vouch answer Q-1 Z"),
      { root: box.root, intent },
    );
    const records = await rows(box);
    t.plan(5);
    t.assert.deepEqual([result.exitCode, result.stdout], [2, ""]);
    t.assert.match(
      result.stderr,
      /^VOUCH-ANSWER-RECORDED: evt_[a-f0-9]{64}; Q-1 = B/,
    );
    t.assert.match(refused.stderr, /^VOUCH-ANSWER-CHOICE/);
    t.assert.deepEqual(
      records.map((r) => [r.type, r.choice, r.parent, r.wait_ms]),
      [
        ["question.asked", undefined, undefined, undefined],
        ["question.answered", "B", question.id, 9000],
      ],
    );
    t.assert.equal(await box.read(`${home}/intent.md`), planned());
  });
}
