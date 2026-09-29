import { test } from "node:test";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import {
  branchHistory,
  commitType,
  commitViolation,
  dodEvidence,
  isShellTool,
  readChanges,
  readGit,
  spawn,
} from "../../../core/hooks/lib/git.mjs";

// Git operations and DoD evidence: docs/development/git-guard.md.
const intent = "260929-git";
const sha = (/** @type {string} */ c) => c.repeat(40);

/** @typedef {import('../../../core/hooks/lib/contracts.mjs').AuditEvent} AuditEvent */
/** @param {unknown} value Hand-authored records, some deliberately malformed for the runtime check. */
const events = (value) => /** @type {AuditEvent[]} */ (value);

/**
 * A DoD record as vouch-dod writes it, with the derived identity.
 * @param {Record<string,unknown>} fields
 * @param {number[]} exits
 */
function dod(fields, exits) {
  const record = {
    v: /** @type {const} */ (1),
    type: /** @type {const} */ ("hook.check"),
    ts: "2026-09-29T00:00:00.000Z",
    actor: /** @type {const} */ ("hook"),
    intent,
    check: /** @type {const} */ ("dod"),
    result: exits.every((code) => code === 0) ? "pass" : "fail",
    duration_ms: 3,
    commit: sha("a"),
    clean: true,
    commands: exits.map((code) => ({
      target: "Unit tests",
      command: "node check.js",
      cwd: ".",
      result: code === 0 ? "pass" : "fail",
      duration_ms: 1,
      exit_code: code,
    })),
    output: { path: "build-log.md", sha256: "b".repeat(64) },
    ...fields,
  };
  return {
    id: newId(
      `${record.commit}`,
      JSON.stringify(["hook.check", "dod", intent, record.output?.sha256]),
    ),
    ...record,
  };
}

test("isShellTool names only the registered shell tool of each harness", (t) => {
  t.plan(5);
  t.assert.equal(isShellTool("claude", "Bash"), true);
  t.assert.equal(isShellTool("codex", "Bash"), true);
  t.assert.equal(isShellTool("claude", "Write"), false);
  t.assert.equal(isShellTool("codex", "apply_patch"), false);
  t.assert.equal(isShellTool("claude", "constructor"), false);
});

test("spawn hides windows, bounds Git and keeps it free of optional locks", async (t) => {
  /** @type {unknown[][]} */ const calls = [];
  /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').SpawnPort} */
  const execute = (file, args, options) => {
    calls.push([file, args, options]);
    return { status: 0, stdout: "ok" };
  };
  await spawn("git", ["status"], { cwd: "/r" }, execute);
  await spawn("npm test", [], { shell: true, maxBuffer: 5 }, execute);
  t.plan(2);
  t.assert.deepEqual(calls[0], [
    "git",
    ["--no-optional-locks", "status"],
    { windowsHide: true, maxBuffer: 1 << 28, timeout: 1500, cwd: "/r" },
  ]);
  t.assert.deepEqual(calls[1], [
    "npm test",
    [],
    { windowsHide: true, maxBuffer: 5, shell: true },
  ]);
});

test("readGit returns stdout only when Git exits zero", async (t) => {
  /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').Spawned[]} */
  const answers = [
    { status: 0, stdout: "main\n" },
    { status: 1, stdout: "partial" },
    { status: null, error: new Error("timeout") },
  ];
  /** @type {unknown[]} */ const seen = [];
  const git = readGit("/project", (file, args, options) => {
    seen.push([file, args, options]);
    return /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').Spawned} */ (
      answers.shift()
    );
  });
  t.plan(4);
  t.assert.equal(await git("symbolic-ref", "--short", "HEAD"), "main\n");
  t.assert.equal(await git("log"), null);
  t.assert.equal(await git("log"), null);
  t.assert.deepEqual(seen[0], [
    "git",
    ["--no-optional-locks", "symbolic-ref", "--short", "HEAD"],
    {
      windowsHide: true,
      maxBuffer: 1 << 28,
      timeout: 1500,
      cwd: "/project",
      encoding: "utf8",
    },
  ]);
});

test("commitType reads a registered type and a Unit scope from the subject", (t) => {
  const cases = [
    ["feat(U1): add orders", { type: "feat", unit: "U1" }],
    ["fix(api.v2)!: drop the field", { type: "fix", unit: "api.v2" }],
    ["contract(U-1): types\n\nbody", { type: "contract", unit: "U-1" }],
    ["feature(U1): add", null],
    ["feat: add", null],
    ["feat(U1):add", null],
    ["feat(U 1): add", null],
    ["feat(U1): ", null],
    ["wip", null],
  ];
  t.plan(cases.length);
  for (const [subject, expected] of cases)
    t.assert.deepEqual(commitType(`${subject}`), expected, `${subject}`);
});

test("readChanges pairs name-status entries and ignores a trailing separator", (t) => {
  t.plan(3);
  t.assert.deepEqual(readChanges("M\0src/a.js\0D\0tests/a test.js\0"), [
    ["M", "src/a.js"],
    ["D", "tests/a test.js"],
  ]);
  t.assert.deepEqual(readChanges("\nA\0日本語.md\0"), [["A", "日本語.md"]]);
  t.assert.deepEqual(readChanges(""), []);
});

test("branchHistory lists the commits outside every protected branch, oldest first", async (t) => {
  /** @type {string[][]} */ const calls = [];
  const log = `\x1e${sha("1")}\x1fcontract(U1): types\0\nA\0src/types.js\0\x1e${sha("2")}\x1ftest(U1): red\0\nA\0tests/a.test.js\0M\0vouch/x.md\0\x1e${sha("3")}\x1fdocs: empty\0`;
  const history = await branchHistory(async (...args) => {
    calls.push(args);
    return log;
  });
  t.plan(2);
  t.assert.deepEqual(history, [
    {
      sha: sha("1"),
      subject: "contract(U1): types",
      changes: [["A", "src/types.js"]],
    },
    {
      sha: sha("2"),
      subject: "test(U1): red",
      changes: [
        ["A", "tests/a.test.js"],
        ["M", "vouch/x.md"],
      ],
    },
    { sha: sha("3"), subject: "docs: empty", changes: [] },
  ]);
  t.assert.deepEqual(calls, [
    [
      "log",
      "--no-merges",
      "--no-renames",
      "--reverse",
      "--name-status",
      "-z",
      "HEAD",
      "--format=%x1e%H%x1f%s",
      "--not",
      "--branches=[m]ain",
      "--remotes=*/[m]ain",
    ],
  ]);
});

test("branchHistory is empty without a commit and null when Git cannot list the log", async (t) => {
  /** @param {Record<string,string|null>} answers */
  const port =
    (answers) =>
    async (/** @type {string[]} */ ...args) =>
      answers[`${args[0]}`] ?? null;
  t.plan(2);
  t.assert.deepEqual(await branchHistory(port({ "rev-parse": null })), []);
  t.assert.equal(await branchHistory(port({ "rev-parse": "x\n" })), null);
});

test("dodEvidence counts clean, derived, nonsynthetic dod records of the Intent", (t) => {
  const pass = dod({ commit: sha("a") }, [0]);
  const fail = dod({ commit: sha("b") }, [0, 1]);
  const refused = [
    dod({ commit: sha("c"), synthetic: true }, [1]),
    dod({ commit: sha("d"), clean: false }, [1]),
    dod({ commit: sha("e"), intent: "other" }, [1]),
    { ...dod({ commit: sha("f") }, [1]), id: "evt_forged" },
    dod({ commit: sha("9"), check: "contract" }, [1]),
  ];
  const noExit = dod({ commit: sha("8") }, [0]);
  const unran = {
    ...noExit,
    result: "fail",
    commands: [
      { target: "t", command: "c", cwd: ".", result: "fail", duration_ms: 0 },
    ],
  };
  const { commit: _commit, ...uncommitted } = dod({}, [1]);
  const proven = dodEvidence(
    events([
      pass,
      fail,
      ...refused,
      unran,
      uncommitted,
      { ...pass, type: "session.started", session: "s" },
    ]),
    intent,
    newId,
  );
  t.plan(9);
  t.assert.equal(proven(sha("a"), "pass"), true);
  t.assert.equal(proven(sha("a"), "fail"), false);
  t.assert.equal(proven(sha("b"), "fail"), true);
  t.assert.equal(proven(sha("b"), "pass"), false);
  for (const c of ["c", "d", "e", "f"])
    t.assert.equal(proven(sha(c), "fail"), false, c);
  t.assert.equal(proven(sha("8"), "fail"), false, "no exit code");
});

/** @param {string} c @param {string} subject @param {[string,string][]} changes */
const commit = (c, subject, changes = [["A", `src/${c}.js`]]) => ({
  sha: sha(c),
  subject,
  changes,
});
const green = new Set([sha("1"), sha("4")]);
const red = new Set([sha("2"), sha("5")]);
/** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').Proven} */
const proven = (hash, kind) => (kind === "pass" ? green : red).has(hash);
const units = ["U1", "U2"];

test("commitViolation leaves commits outside code alone and asks code for a registered type and Unit", (t) => {
  const cases = [
    [
      commit("0", "chore(vouch): approve", [
        ["M", "vouch/intents/x/intent.md"],
      ]),
      null,
    ],
    [commit("0", "wip", [["A", "VOUCH/notes.md"]]), null],
    [
      commit("0", "wip"),
      ["type", "contract, test, feat, fix, refactor, docs, chore"],
    ],
    [
      commit("0", "style(U1): format"),
      ["type", "contract, test, feat, fix, refactor, docs, chore"],
    ],
    [commit("0", "docs(U9): readme"), ["unit", "U9"]],
    [commit("0", "refactor(U1): rename"), null],
    [commit("0", "contract(U2): types"), null],
  ];
  t.plan(cases.length);
  for (const [item, expected] of cases)
    t.assert.deepEqual(
      commitViolation(
        /** @type {ReturnType<typeof commit>} */ (item),
        [],
        units,
        proven,
      ),
      expected,
    );
});

test("commitViolation lets only test commits change or delete test files", (t) => {
  const tests = [
    ["M", "tests/app.test.js"],
    ["D", "src/__tests__/app.js"],
    ["T", "pkg/Spec/app.rb"],
    ["M", "src/app_test.go"],
    ["D", "src/test_app.py"],
    ["M", "src/app.spec.ts"],
    ["M", "test/golden/out.md"],
  ];
  t.plan(tests.length * 2 + 3);
  for (const change of tests) {
    const changes = /** @type {[string,string][]} */ ([change]);
    t.assert.deepEqual(
      commitViolation(
        commit("0", "refactor(U1): x", changes),
        [],
        units,
        proven,
      ),
      ["test", "test(U1)"],
      change.join(" "),
    );
    t.assert.equal(
      commitViolation(commit("0", "test(U1): x", changes), [], units, proven),
      null,
    );
  }
  t.assert.equal(
    commitViolation(
      commit("0", "refactor(U1): x", [["A", "tests/new.test.js"]]),
      [],
      units,
      proven,
    ),
    null,
    "additions",
  );
  t.assert.equal(
    commitViolation(
      commit("0", "refactor(U1): x", [
        ["M", "src/latest.js"],
        ["M", "src/testing.js"],
      ]),
      [],
      units,
      proven,
    ),
    null,
    "lookalike names",
  );
  t.assert.deepEqual(
    commitViolation(
      commit("0", "contract(U1): x", [["D", "Tests./x.js"]]),
      [],
      units,
      proven,
    ),
    ["test", "test(U1)"],
    "normalized segments",
  );
});

test("commitViolation requires a green contract then a red test of the same Unit before feat", (t) => {
  const contract = commit("1", "contract(U1): types");
  const test = commit("2", "test(U1): red", [["A", "tests/u1.test.js"]]);
  const feat = commit("3", "feat(U1): impl");
  const chain = [
    "order",
    "contract(U1) with a passing DoD, then test(U1) with a failing DoD",
  ];
  const cases = [
    [[contract, test], null],
    [[contract], chain],
    [[test, contract], chain],
    [[commit("7", "contract(U1): types"), test], chain],
    [[contract, commit("8", "test(U1): red")], chain],
    [[commit("4", "contract(U2): types"), commit("5", "test(U2): red")], chain],
    [[commit("4", "chore(U1): x"), commit("5", "docs(U1): red")], chain],
    [[], chain],
  ];
  t.plan(cases.length);
  for (const [earlier, expected] of cases)
    t.assert.deepEqual(
      commitViolation(
        feat,
        /** @type {ReturnType<typeof commit>[]} */ (earlier),
        units,
        proven,
      ),
      expected,
    );
});

test("commitViolation requires only a red test of the same Unit before fix", (t) => {
  const fix = commit("3", "fix(U1): repair");
  t.plan(3);
  t.assert.equal(
    commitViolation(fix, [commit("2", "test(U1): reproduce")], units, proven),
    null,
  );
  t.assert.deepEqual(
    commitViolation(fix, [commit("1", "test(U1): green")], units, proven),
    ["order", "test(U1) with a failing DoD"],
  );
  t.assert.deepEqual(
    commitViolation(fix, [commit("5", "test(U2): red")], units, proven),
    ["order", "test(U1) with a failing DoD"],
  );
});
