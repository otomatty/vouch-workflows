import { readFile, rm, writeFile } from "node:fs/promises";
import { branch, gitBox, gitIn } from "../helpers/git-guard.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";

// Git push and commit checks through the registered guard: docs/development/git-guard.md.

test("pushes to main and pull request merges deny in both harnesses with or without an Intent, and other pushes pass", async (t) => {
  const box = await gitBox(t);
  /** @type {[string,'claude'|'codex',string|undefined][]} */
  const denied = [
    ["git push origin main", "claude", undefined],
    ["git push origin main", "codex", ""],
    ["git push -u origin HEAD:main", "codex", undefined],
    ["git push --all origin", "claude", ""],
    ["git push origin :main", "codex", undefined],
  ];
  const results = denied.map(([command, harness, scope]) =>
    box.guard(command, { harness, ...(scope === "" ? { intent: "" } : {}) }),
  );
  const allowed = [
    box.guard(`git push -u origin ${branch}`),
    box.guard("git push --dry-run origin main"),
    box.guard("git push", { harness: "codex" }),
  ];
  gitIn(box.root, "checkout", "-q", "main");
  const merge = box.guard("gh pr merge 23 --squash", { harness: "codex" });
  const onMain = [
    box.guard("git push"),
    box.guard("git push origin HEAD", { intent: "" }),
  ];
  t.plan(results.length * 2 + allowed.length + onMain.length + 1);
  t.assert.equal(
    merge.stderr,
    "VOUCH-GIT-MERGE: Bash gh pr merge 23 --squash; a person merges the pull request after reading the Brief\n",
  );
  for (const result of results) {
    t.assert.equal(result.exitCode, 2);
    t.assert.match(
      result.stderr,
      /^VOUCH-GIT-PUSH: Bash git push .+; (?:main is protected|all branches include a protected branch); it changes only through a pull request a person merges\n$/,
    );
  }
  for (const result of allowed)
    t.assert.deepEqual([result.exitCode, result.stderr], [0, ""]);
  for (const result of onMain)
    t.assert.match(result.stderr, /^VOUCH-GIT-PUSH: /);
});

test("the contract, red test and green implementation order commits and pushes with DoD evidence", async (t) => {
  const box = await gitBox(t);
  await box.write("src/types.js", "// contract\n");
  const early = box.guard('git add -A && git commit -m "feat(U1): add app"');
  box.commit("contract(U1): app types");
  const contract = box.dod();
  await box.write("tests/app.test.js", "// red\n");
  const beforeRed = box.guard("git add -A && git commit -m 'test(U1): app'");
  box.commit("test(U1): app");
  const red = box.dod();
  await box.write("src/app.js", "// app\n");
  const heredoc = box.guard(
    "git add -A && git commit -m \"$(cat <<'EOF'\nfeat(U1): add app\n\nBody.\nEOF\n)\"",
  );
  box.commit("feat(U1): add app");
  const green = box.dod();
  const push = box.guard(`git push -u origin ${branch}`, { harness: "codex" });
  const log = await box.read(`vouch/intents/260927-review/build-log.md`);
  t.plan(12);
  t.assert.equal(early.exitCode, 2);
  t.assert.equal(
    early.stderr,
    "VOUCH-COMMIT-ORDER: Bash feat(U1): add app; the implementation needs contract(U1) with a passing DoD, then test(U1) with a failing DoD earlier on this branch\n",
  );
  t.assert.deepEqual([contract.status, contract.report.ok], [0, true]);
  t.assert.deepEqual([beforeRed.exitCode, beforeRed.stderr], [0, ""]);
  t.assert.deepEqual([red.status, red.report.ok], [2, false]);
  t.assert.deepEqual(
    red.report.checks.map((/** @type {{id:string}} */ item) => item.id),
    ["DOD-COMMIT", "DOD-COMMAND", "DOD-RECORD"],
  );
  t.assert.deepEqual([heredoc.exitCode, heredoc.stderr], [0, ""]);
  t.assert.deepEqual([green.status, green.report.ok], [0, true]);
  t.assert.deepEqual([push.exitCode, push.stderr], [0, ""]);
  t.assert.equal((log.match(/<!-- dod -->/g) ?? []).length, 3);
  t.assert.match(log, /1 failing: app is missing/);
  t.assert.equal(
    (await box.read(box.audit))
      .trim()
      .split("\n")
      .filter((line) => line.includes('"check":"dod"')).length,
    3,
  );
});

test("evidence of another Unit, another branch or a dirty tree does not satisfy the order", async (t) => {
  const box = await gitBox(t);
  await box.write("src/types.js", "// contract\n");
  box.commit("contract(U1): types");
  box.dod();
  gitIn(box.root, "checkout", "-qb", "side");
  await box.write("tests/app.test.js", "// red on another branch\n");
  box.commit("test(U1): app");
  box.dod();
  gitIn(box.root, "checkout", "-q", branch);
  await box.write("tests/app.test.js", "// red for U2\n");
  box.commit("test(U2): app");
  box.dod();
  await box.write("src/app.js", "// app\n");
  const otherUnit = box.guard("git add -A && git commit -m 'feat(U1): app'");
  await rm(box.path("src/app.js"));
  await box.write("tests/app.test.js", "// red for U1\n");
  box.commit("test(U1): app");
  await box.write("src/dirty.js", "// uncommitted\n");
  const dirty = box.dod();
  await box.write("src/app.js", "// app\n");
  const afterDirty = box.guard("git add -A && git commit -m 'feat(U1): app'");
  t.plan(6);
  for (const result of [otherUnit, afterDirty]) {
    t.assert.equal(result.exitCode, 2);
    t.assert.match(
      result.stderr,
      /^VOUCH-COMMIT-ORDER: Bash feat\(U1\): app; /,
    );
  }
  t.assert.equal(dirty.status, 2);
  t.assert.deepEqual(dirty.report.checks[0], {
    id: "DOD-COMMIT",
    ok: false,
    detail: `commit \`${gitIn(box.root, "rev-parse", "HEAD").trim()}\` (uncommitted changes outside vouch/; not linked)`,
  });
});

test("forged, synthetic and relabeled DoD records are not evidence", async (t) => {
  const box = await gitBox(t);
  await box.write("src/types.js", "// contract\n");
  const contract = box.commit("contract(U1): types");
  await box.write("tests/app.test.js", "// red\n");
  const test = box.commit("test(U1): app");
  const output = { path: "build-log.md", sha256: "a".repeat(64) };
  /** @param {string} commit @param {string} result @param {Record<string,unknown>} extra */
  const record = (commit, result, extra) => ({
    id: `evt_${commit.slice(0, 8)}_${result}`,
    v: 1,
    type: "hook.check",
    ts: "2026-09-29T00:00:00.000Z",
    actor: "hook",
    intent: "260927-review",
    check: "dod",
    result,
    duration_ms: 1,
    commit,
    clean: true,
    commands: [
      {
        target: "Unit tests",
        command: "node check.js",
        cwd: ".",
        result,
        duration_ms: 1,
        exit_code: result === "pass" ? 0 : 1,
      },
    ],
    output,
    ...extra,
  });
  const forged = [
    record(contract, "pass", {}),
    record(test, "fail", { synthetic: true, id: "evt_synthetic" }),
  ];
  await writeFile(
    box.path(box.audit),
    `${await readFile(box.path(box.audit), "utf8")}${forged.map((item) => `${JSON.stringify(item)}\n`).join("")}`,
  );
  await box.write("src/app.js", "// app\n");
  const result = box.guard("git add -A && git commit -m 'feat(U1): app'");
  t.plan(2);
  t.assert.equal(result.exitCode, 2);
  t.assert.match(result.stderr, /^VOUCH-COMMIT-ORDER: /);
});

test("type, unit and test rules deny commits and the push that carries them", async (t) => {
  const box = await gitBox(t);
  const notes = box.guard("git add vouch && git commit -m 'notes'");
  await box.write("tests/app.test.js", "// test\n");
  box.commit("test(U1): app");
  await box.write("tests/app.test.js", "// weakened\n");
  const weakened = box.guard("git commit -am 'refactor(U1): tidy'");
  const deleted = box.guard(
    "git rm -q tests/app.test.js && git commit -m 'fix(U1): repair'",
  );
  const retyped = box.guard("git commit -am 'test(U1): tidy'");
  const untyped = box.guard("git commit -am 'wip'");
  const unknown = box.guard("git commit -am 'chore(U9): tidy'");
  box.commit("refactor(U1): tidy");
  const push = box.guard(`git push origin ${branch}`);
  t.plan(7);
  t.assert.match(
    weakened.stderr,
    /^VOUCH-COMMIT-TEST: Bash refactor\(U1\): tidy; test files change or disappear only in test\(U1\) commits\n$/,
  );
  t.assert.match(
    deleted.stderr,
    /^VOUCH-COMMIT-TEST: Bash fix\(U1\): repair; /,
  );
  t.assert.deepEqual([retyped.exitCode, retyped.stderr], [0, ""]);
  t.assert.match(untyped.stderr, /^VOUCH-COMMIT-TYPE: Bash wip; /);
  t.assert.match(
    unknown.stderr,
    /^VOUCH-COMMIT-UNIT: Bash chore\(U9\): tidy; U9 is not a Unit of the plan\n$/,
  );
  t.assert.deepEqual([notes.exitCode, notes.stderr], [0, ""]);
  t.assert.match(
    push.stderr,
    /^VOUCH-COMMIT-TEST: Bash git push \([0-9a-f]{12} refactor\(U1\): tidy\); /,
  );
});

test("replaying the same Git input returns the same decision and changes no file", async (t) => {
  const box = await gitBox(t);
  await box.write("src/app.js", "// app\n");
  const before = tree(box.root);
  const commands = [
    "git add -A && git commit -m 'feat(U1): app'",
    "git push origin main",
    `git push origin ${branch}`,
  ];
  const first = commands.map((command) => box.guard(command));
  const second = commands.map((command) => box.guard(command));
  t.plan(3);
  t.assert.deepEqual(
    second.map((result) => [result.exitCode, result.stderr]),
    first.map((result) => [result.exitCode, result.stderr]),
  );
  t.assert.deepEqual(
    first.map((result) => result.exitCode),
    [2, 2, 0],
  );
  t.assert.deepEqual(tree(box.root), before);
});

test("unreadable audits deny, and repositories other than the project are not ordered", async (t) => {
  const box = await gitBox(t);
  await box.write("src/app.js", "// app\n");
  const other = box.path("vendor/lib");
  gitIn(box.root, "init", "-q", "--initial-branch=main", other);
  await box.write("vendor/lib/a.js", "// vendored\n");
  const nested = box.guard(
    "git -C vendor/lib add -A && git -C vendor/lib commit -m 'feat(U1): vendored'",
  );
  const nestedPush = box.guard("cd vendor/lib && git push");
  await box.write(box.audit, "broken\n");
  const commit = box.guard("git add -A && git commit -m 'feat(U1): app'");
  const push = box.guard(`git push origin ${branch}`);
  const unscoped = box.guard("git add -A && git commit -m 'feat(U1): app'", {
    intent: "",
  });
  t.plan(5);
  t.assert.deepEqual([nested.exitCode, nested.stderr], [0, ""]);
  t.assert.match(
    nestedPush.stderr,
    /^VOUCH-GIT-PUSH: Bash git push; main is protected/,
  );
  for (const result of [commit, push])
    t.assert.match(
      result.stderr,
      /^VOUCH-GIT-UNVERIFIED: Bash .+; the branch history, the plan or the audit could not be read\n$/,
    );
  t.assert.deepEqual([unscoped.exitCode, unscoped.stderr], [0, ""]);
});
