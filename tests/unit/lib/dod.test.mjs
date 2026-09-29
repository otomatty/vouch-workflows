import { test } from "node:test";
import { newId, sha256Hex } from "../../../core/hooks/lib/clock.mjs";
import { runDod } from "../../../core/hooks/lib/dod.mjs";
import { isAuditEvent } from "../../../core/hooks/lib/validation.mjs";
import { evidenced } from "../../helpers/approval.mjs";
import { assertGolden } from "../../helpers/golden.mjs";
import { planned } from "../../helpers/intent-review.mjs";
import { memoryFiles } from "../../helpers/runtime.mjs";

// DoD execution and recording: docs/development/git-guard.md.
const intent = "260929-plan";
const home = `vouch/intents/${intent}`;
const draft = planned();
const approved = draft.replace("status: draft", "status: approved");
const { gate, approval } = evidenced(draft, { intent });
const commit = "c".repeat(40);
const environment = {
  projectRoot: "/project",
  installationRoot: ".claude",
  nodeVersion: "22.19.0",
};
const git = { ok: true, detail: "git version test" };
const rules = [
  "---",
  "language: en",
  "checkpoints: topic",
  "---",
  "",
  "<!-- sec:dod -->",
  "## Definition of done",
  "",
  "| Target | Command and working directory | Pass condition | Evidence location |",
  "| --- | --- | --- | --- |",
  "| Unit tests | `node check.js` in `.` | exit 0 | build-log.md |",
  "| Lint | `npm run lint \\| cat` in `packages/app` | exit 0 | build-log.md |",
  "| Dependency audit | Unconfigured | Unconfigured | Unconfigured |",
  "",
  "<!-- sec:restrictions -->",
  "| Not | `a DoD row` |",
  "",
].join("\n");

/**
 * @param {Record<string,string>} [overrides]
 * @returns {Record<string,string>}
 */
const project = (overrides = {}) => ({
  [`${home}/intent.md`]: approved,
  [`${home}/audit/events.jsonl`]: `${JSON.stringify(gate)}\n${JSON.stringify(approval)}\n`,
  "vouch/rules.md": rules,
  ...overrides,
});

/**
 * Git answers and shell results keyed by command; every call is recorded.
 * @param {Record<string,string|null>} [gitAnswers]
 * @param {Record<string,import('../../../core/hooks/lib/runtime-contracts.mjs').Spawned>} [shell]
 */
function processes(gitAnswers = {}, shell = {}) {
  /** @type {{file:string,args:string[],options:import('node:child_process').SpawnSyncOptions}[]} */
  const calls = [];
  /** @type {Record<string,string|null>} */ const answers = {
    "rev-parse --verify -q HEAD": `${commit}\n`,
    "status --porcelain -z -uall --no-renames": ` M vouch/rules.md\0?? vouch/intents/${intent}/build-log.md\0`,
    ...gitAnswers,
  };
  /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').SpawnPort} */
  const execute = (file, args, options) => {
    calls.push({ file, args, options });
    if (file !== "git")
      return (
        shell[file] ?? {
          status: 1,
          stdout: Buffer.from("1 failing\n"),
          stderr: Buffer.from("AssertionError\n"),
        }
      );
    const answer = answers[args.slice(1).join(" ")];
    return typeof answer === "string"
      ? { status: 0, stdout: answer }
      : { status: 128, stdout: "" };
  };
  return { execute, calls };
}

/** A clock that advances 5 ms per reading. */
function ticking() {
  let ms = 0;
  return () => `2026-09-29T00:00:00.${String(5 * ms++).padStart(3, "0")}Z`;
}

/** @param {import('../../../core/hooks/lib/runtime-contracts.mjs').FileStore & {data:Map<string,string>}} files */
const records = (files) =>
  `${files.data.get(`${home}/audit/events.jsonl`)}`
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

test("runDod runs each configured row, appends build-log.md and records one hook.check", async (t) => {
  const files = memoryFiles(project());
  const run = processes(
    {},
    {
      "npm run lint | cat": {
        status: 0,
        stdout: Buffer.from("clean ```code``` ok\n"),
        stderr: Buffer.from(""),
      },
    },
  );
  const report = await runDod(files, environment, git, {
    intent,
    now: ticking(),
    execute: run.execute,
  });
  const log = `${files.data.get(`${home}/build-log.md`)}`;
  const record = records(files).at(-1);
  t.plan(11);
  t.assert.deepEqual(
    report.checks.map((item) => [item.id, item.ok]),
    [
      ["DOD-COMMIT", true],
      ["DOD-COMMAND", false],
      ["DOD-COMMAND", true],
      ["DOD-COMMAND", false],
      ["DOD-RECORD", true],
    ],
  );
  t.assert.equal(report.ok, false);
  t.assert.deepEqual(
    report.checks.slice(1, 4).map((item) => item.detail),
    [
      `Unit tests: \`node check.js\` fail; ${home}/build-log.md#L8`,
      `Lint: \`npm run lint | cat\` pass; ${home}/build-log.md#L19`,
      `Dependency audit: unconfigured; ${home}/build-log.md#L29`,
    ],
  );
  t.assert.equal(log.split("\n")[7], "### Unit tests");
  await assertGolden(t, "dod-build-log.md", log);
  t.assert.equal(isAuditEvent(record), true);
  t.assert.deepEqual(
    { ...record, id: "", output: "" },
    {
      id: "",
      v: 1,
      type: "hook.check",
      ts: "2026-09-29T00:00:00.000Z",
      actor: "hook",
      intent,
      stage: "build",
      check: "dod",
      result: "fail",
      duration_ms: 25,
      missing: 1,
      commit,
      clean: true,
      commands: [
        {
          target: "Unit tests",
          command: "node check.js",
          cwd: ".",
          result: "fail",
          duration_ms: 5,
          exit_code: 1,
        },
        {
          target: "Lint",
          command: "npm run lint | cat",
          cwd: "packages/app",
          result: "pass",
          duration_ms: 5,
          exit_code: 0,
        },
      ],
      output: "",
    },
  );
  t.assert.deepEqual(record.output, {
    path: "build-log.md",
    sha256: sha256Hex(Buffer.from(log, "utf8")),
  });
  t.assert.equal(
    record.id,
    newId(
      commit,
      JSON.stringify(["hook.check", "dod", intent, record.output.sha256]),
    ),
  );
  t.assert.equal(report.checks.at(-1)?.detail, `hook.check ${record.id}`);
  t.assert.deepEqual(
    run.calls
      .filter((call) => call.file !== "git")
      .map((call) => [call.file, call.args, call.options]),
    [
      [
        "node check.js",
        [],
        {
          windowsHide: true,
          maxBuffer: 1 << 28,
          cwd: ".",
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ],
      [
        "npm run lint | cat",
        [],
        {
          windowsHide: true,
          maxBuffer: 1 << 28,
          cwd: "packages/app",
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ],
    ],
  );
});

test("runDod passes only when every row is configured and exits zero, and appends after earlier text", async (t) => {
  const passing = rules.replace(
    "| Dependency audit | Unconfigured | Unconfigured | Unconfigured |",
    "|  | `npm audit` | exit 0 | build-log.md |",
  );
  const ok = { status: 0, stdout: "ok\n", stderr: "" };
  const files = memoryFiles(
    project({
      "vouch/rules.md": passing,
      [`${home}/build-log.md`]: "# Build log\n\nNotes without a newline",
    }),
  );
  const report = await runDod(files, environment, git, {
    intent,
    now: ticking(),
    execute: processes(
      {},
      { "node check.js": ok, "npm run lint | cat": ok, "npm audit": ok },
    ).execute,
  });
  const log = `${files.data.get(`${home}/build-log.md`)}`;
  const [first] = report.checks.slice(1);
  t.plan(5);
  t.assert.equal(report.ok, true);
  t.assert.equal(records(files).at(-1).result, "pass");
  t.assert.equal(
    log.startsWith("# Build log\n\nNotes without a newline\n\n<!-- dod -->\n"),
    true,
  );
  t.assert.equal(first?.detail.endsWith(`build-log.md#L12`), true);
  t.assert.equal(log.split("\n")[11], "### Unit tests");
});

test("runDod writes nothing without a configured Intent, an evidenced approved plan or DoD rows", async (t) => {
  const cases = [
    [null, project(), "DOD-SCOPE"],
    [intent, project({ [`${home}/intent.md`]: draft }), "DOD-PLAN"],
    [
      intent,
      project({ [`${home}/audit/events.jsonl`]: `${JSON.stringify(gate)}\n` }),
      "DOD-PLAN",
    ],
    [
      intent,
      project({ [`${home}/intent.md`]: "---\nstatus: approved\n---\n" }),
      "DOD-PLAN",
    ],
    [intent, { ...project(), "vouch/rules.md": "" }, "DOD-RULES"],
    [
      intent,
      project({
        "vouch/rules.md": "<!-- sec:dod -->\n| a | b |\n| --- | --- |\n",
      }),
      "DOD-RULES",
    ],
  ];
  const missing = project();
  Reflect.deleteProperty(missing, "vouch/rules.md");
  cases.push([intent, missing, "DOD-RULES"]);
  t.plan(cases.length * 3);
  for (const [scope, initial, id] of cases) {
    const before = JSON.stringify(initial);
    const files = memoryFiles(/** @type {Record<string,string>} */ (initial));
    const run = processes();
    const report = await runDod(files, environment, git, {
      intent: /** @type {string|null} */ (scope),
      now: ticking(),
      execute: run.execute,
    });
    t.assert.deepEqual(
      [report.ok, report.checks.map((item) => item.id)],
      [false, [id]],
    );
    t.assert.equal(JSON.stringify(Object.fromEntries(files.data)), before);
    t.assert.deepEqual(run.calls, []);
  }
});

test("runDod links evidence only to a commit without changes outside vouch", async (t) => {
  const cases = [
    [{}, true, commit],
    [{ "status --porcelain -z -uall --no-renames": "" }, true, commit],
    [
      { "status --porcelain -z -uall --no-renames": " M src/app.js\0" },
      false,
      commit,
    ],
    [
      {
        "status --porcelain -z -uall --no-renames":
          "?? vouchers/x\0 M vouch/a\0",
      },
      false,
      commit,
    ],
    [{ "status --porcelain -z -uall --no-renames": null }, false, commit],
    [{ "rev-parse --verify -q HEAD": null }, false, undefined],
  ];
  t.plan(cases.length * 3);
  for (const [answers, clean, head] of cases) {
    const files = memoryFiles(project());
    const report = await runDod(files, environment, git, {
      intent,
      now: ticking(),
      execute: processes(/** @type {Record<string,string|null>} */ (answers))
        .execute,
    });
    const record = records(files).at(-1);
    t.assert.deepEqual([record.clean, record.commit], [clean, head]);
    t.assert.equal(report.checks[0]?.ok, clean);
    t.assert.match(
      `${report.checks[0]?.detail}`,
      head
        ? clean
          ? /^commit `c{40}`$/
          : /^commit `c{40}` \(uncommitted changes outside vouch\/; not linked\)$/
        : /^commit none$/,
    );
  }
});

test("runDod keeps the last output lines in a fence longer than any backtick run", async (t) => {
  const long = Array.from({ length: 205 }, (_, i) => `line ${i + 1}`).join(
    "\n",
  );
  const files = memoryFiles(
    project({
      "vouch/rules.md": rules.replace("| Lint |", "| ````Lint |"),
    }),
  );
  await runDod(files, environment, git, {
    intent,
    now: ticking(),
    execute: processes(
      {},
      {
        "node check.js": { status: 0, stdout: `${long}\n`, stderr: "" },
        "npm run lint | cat": { status: 2, stdout: "a ````` b", stderr: "" },
      },
    ).execute,
  });
  const log = `${files.data.get(`${home}/build-log.md`)}`;
  t.plan(4);
  t.assert.equal(
    log.includes("```text\n(5 earlier lines omitted)\nline 6\n"),
    true,
  );
  t.assert.equal(log.includes("line 5\n"), false);
  t.assert.equal(log.includes("line 205\n```\n"), true);
  t.assert.equal(log.includes("``````text\na ````` b\n``````\n"), true);
});

test("runDod records a command that could not start as a failure without an exit code", async (t) => {
  const files = memoryFiles(project());
  const store = {
    ...files,
    resolvePath: async (/** @type {string} */ path) => {
      if (path === "packages/app")
        throw new Error("FS-ESCAPE: outside project root");
      return path;
    },
  };
  const report = await runDod(store, environment, git, {
    intent,
    now: ticking(),
    execute: processes(
      {},
      {
        "node check.js": {
          status: null,
          error: new Error("spawnSync /bin/sh ENOENT"),
        },
      },
    ).execute,
  });
  const record = records(files).at(-1);
  const log = `${files.data.get(`${home}/build-log.md`)}`;
  t.plan(4);
  t.assert.deepEqual(
    record.commands.map(
      (/** @type {{exit_code?:number,result:string}} */ item) => [
        item.result,
        item.exit_code,
      ],
    ),
    [
      ["fail", undefined],
      ["fail", undefined],
    ],
  );
  t.assert.equal(
    log.includes(
      "fail (exit none, 5 ms)\n\n```text\nspawnSync /bin/sh ENOENT\n```",
    ),
    true,
  );
  t.assert.equal(log.includes("FS-ESCAPE: outside project root"), true);
  t.assert.equal(report.ok, false);
});
