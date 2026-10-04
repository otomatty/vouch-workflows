import { spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { test as group } from "node:test";
import { pathToFileURL } from "node:url";
import { source } from "../helpers/commands.mjs";
import { deriveFixture } from "../helpers/fixtures.mjs";
import { gitIn } from "../helpers/git-guard.mjs";
import { defaultTestInstant } from "../helpers/hook-process.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { planned } from "../helpers/intent-review.mjs";
import { readJson, validator } from "../helpers/registry.mjs";
import { runHook, sandbox } from "../helpers/runtime.mjs";

const intent = "260930-life";
const audit = `vouch/intents/${intent}/audit/events.jsonl`;
const clock = pathToFileURL(resolve("tests/helpers/fixed-clock.mjs")).href;

/** @param {import('node:test').TestContext} t */
async function installed(t) {
  const box = await sandbox(t);
  await cp(resolve("core/hooks"), box.path(".claude/hooks"), {
    recursive: true,
  });
  await cp(resolve("core/registry"), box.path(".claude/registry"), {
    recursive: true,
  });
  await box.write(`vouch/intents/${intent}/intent.md`, planned());
  await box.write(".gitignore", ".claude/\n");
  await box.write("src/app.js", "export const n = 1;\n");
  await box.write(
    "vouch/rules.md",
    "# Rules\n\n| ID | Rule |\n| --- | --- |\n| K-1 | keep evidence |\n",
  );
  /** @param {string[]} args @param {string} [scope] */
  const run = (args, scope = intent) => {
    const result = spawnSync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        `--import=${clock}`,
        box.path(".claude/hooks/vouch-lifecycle.mjs"),
        ...args,
      ],
      {
        cwd: box.root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        env: {
          ...process.env,
          VOUCH_INTENT: scope,
          VOUCH_TEST_TIME: defaultTestInstant,
        },
      },
    );
    return {
      status: result.status,
      stderr: result.stderr,
      report: JSON.parse(result.stdout),
    };
  };
  const rows = async (scope = intent) =>
    (await box.read(`vouch/intents/${scope}/audit/events.jsonl`))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { box, run, rows };
}

test("the lifecycle command reports a missing Intent without writing", (t) => {
  const missing = source("vouch-lifecycle", ["intent-created"]);
  const unknown = source("vouch-lifecycle", ["not-a-record"], {
    VOUCH_INTENT: "260930-life",
  });
  t.plan(4);
  for (const result of [missing, unknown]) {
    const report = JSON.parse(result.stdout);
    t.assert.equal(result.status, 2);
    t.assert.equal(
      validator("doctor-report")(report) &&
        report.checks[0].id.startsWith("LIFECYCLE-"),
      true,
    );
  }
});

group(
  "an installed command records plan, stage, unit and learn measurements",
  async (t) => {
    /** @type {Awaited<ReturnType<typeof installed>>} */ let setup;
    await test(
      "prepare the installed lifecycle command and base commit",
      async () => {
        setup = await installed(t);
        const { box } = setup;
        gitIn(box.root, "add", "--", ".gitignore", "src/app.js", "vouch");
        gitIn(box.root, "commit", "-qm", "chore: base");
        await box.write("src/app.js", "export const n = 2;\n");
      },
      t,
    );
    const steps = [
      ["intent-created"],
      ["stage-started", "design"],
      ["stage-completed", "design"],
      ["stage-completed", "build"],
      ["unit-started", "U1"],
      ["unit-completed", "U1"],
    ];
    /** @type {ReturnType<Awaited<ReturnType<typeof installed>>['run']>[]} */
    const results = [];
    await test(
      "record the Intent and measured design stage",
      () => {
        results.push(...steps.slice(0, 3).map((args) => setup.run(args)));
      },
      t,
    );
    await test(
      "record the remaining stage and Unit and verify every measurement",
      async (t) => {
        results.push(...steps.slice(3).map((args) => setup.run(args)));
        const recorded = await setup.rows();
        t.plan(4);
        t.assert.deepEqual(
          results.map((result) => result.report.checks[0].id),
          [
            "LIFECYCLE-RECORDED",
            "LIFECYCLE-RECORDED",
            "LIFECYCLE-RECORDED",
            "LIFECYCLE-UNMEASURED",
            "LIFECYCLE-RECORDED",
            "LIFECYCLE-RECORDED",
          ],
        );
        t.assert.deepEqual(
          recorded.map((row) => row.type),
          [
            "intent.created",
            "stage.started",
            "stage.completed",
            "unit.started",
            "unit.completed",
          ],
        );
        t.assert.equal(recorded[4].files_changed > 0, true);
        t.assert.equal(
          recorded.every((row) => validator("audit-event")(row)),
          true,
        );
      },
      t,
    );
    await test(
      "commit the rules and record the measured Learn addition",
      async (t) => {
        const { box, run, rows } = setup;
        t.plan(2);
        gitIn(box.root, "add", "--", "vouch/rules.md", "src/app.js");
        gitIn(box.root, "commit", "-qm", "chore: rules");
        await box.write(
          "vouch/rules.md",
          `${await box.read("vouch/rules.md")}| K-2 | count rows |\n`,
        );
        const learned = run(["learn-recorded"]);
        t.assert.equal(
          (await rows()).find((row) => row.type === "learn.recorded")
            ?.rules_added,
          1,
        );
        t.assert.equal(learned.report.ok, true);
      },
      t,
    );
  },
);

test("gates, review and session end are recorded from the installed entry", async (t) => {
  const { box, run, rows } = await installed(t);
  run(["intent-created"]);
  const opened = runHook(
    "vouch-record-intent-review",
    deriveFixture(
      readJson(
        "tests/fixtures/harness/claude/2.1.283/linux/print/UserPromptSubmit.json",
      ),
      { cwd: box.root, prompt: "vouch review" },
    ),
    { root: box.root, intent },
  );
  const started = runHook(
    "vouch-record-session-start",
    deriveFixture(
      readJson(
        "tests/fixtures/harness/claude/2.1.283/linux/print/SessionStart.startup.json",
      ),
      { cwd: box.root },
    ),
    { root: box.root, intent },
  );
  await box.write(
    `vouch/intents/${intent}/review.md`,
    [
      "| R-1 | note |",
      "<!-- sec:sabotage -->",
      "| parser | unit | caught | restored |",
      "<!-- sec:limitations -->",
    ].join("\n"),
  );
  const session = (await rows()).find((row) => row.type === "session.started");
  const results = [
    run(["gate-approved"]),
    run(["gate-rejected", "needs-work"]),
    run(["review-requested", "1"]),
    run(["review-completed", "1"]),
    run(["session-ended", session.session]),
    run(["intent-completed"]),
  ];
  const types = (await rows()).map((row) => row.type);
  t.plan(6);
  t.assert.equal(opened.exitCode, 2);
  t.assert.equal(started.exitCode, 0);
  t.assert.deepEqual(
    results.map((result) => result.report.ok),
    [true, true, true, true, true, true],
  );
  t.assert.deepEqual(types, [
    "intent.created",
    "gate.opened",
    "session.started",
    "gate.approved",
    "gate.rejected",
    "review.requested",
    "review.completed",
    "session.ended",
    "intent.completed",
  ]);
  const completed = (await rows()).find(
    (row) => row.type === "intent.completed",
  );
  t.assert.equal(completed.ai_work_ms >= 0, true);
  t.assert.equal(
    (await rows()).find((row) => row.type === "review.completed").findings,
    1,
  );
});

test("replay keeps the first record, a conflict does not rewrite, and Stop is not session end", async (t) => {
  const { box, run, rows } = await installed(t);
  const first = run(["intent-created"]);
  const bytes = await box.read(audit);
  const replay = run(["intent-created"]);
  await box.write(
    `vouch/intents/${intent}/intent.md`,
    planned([["U1", "H: contract", "required: contract"]]),
  );
  const conflict = run(["intent-created"]);
  await box.write(`vouch/intents/other-intent/intent.md`, planned());
  const other = run(["intent-created"], "other-intent");
  const stop = runHook(
    "vouch-record-aside-answer",
    deriveFixture(
      readJson("tests/fixtures/harness/claude/2.1.283/linux/print/Stop.json"),
      { cwd: box.root },
    ),
    { root: box.root, intent },
  );
  t.plan(8);
  t.assert.equal(first.report.ok, true);
  t.assert.equal(other.report.ok, true);
  t.assert.match(replay.report.checks[0].detail, /duplicate/);
  t.assert.equal(conflict.report.checks[0].id, "LIFECYCLE-CONFLICT");
  t.assert.equal(await box.read(audit), bytes);
  t.assert.equal((await rows("other-intent"))[0].type, "intent.created");
  t.assert.equal(stop.exitCode, 0);
  t.assert.equal((await box.read(audit)).includes("session.ended"), false);
});
