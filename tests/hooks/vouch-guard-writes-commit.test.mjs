import { rm } from "node:fs/promises";
import {
  audit,
  branch,
  buildLog,
  gitBox,
  gitIn,
} from "../helpers/git-guard.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";

// Commit order and test protection through the registered guard: docs/development/git-guard.md.

test("the contract and red test DoD runs order the implementation commit", async (t) => {
  const box = await gitBox(t);
  await box.write("src/types.js", "// contract\n");
  const early = box.guard('git add -A && git commit -m "feat(U1): add app"');
  box.commit("contract(U1): app types");
  const contract = box.dod();
  await box.write("tests/app.test.js", "// red\n");
  box.commit("test(U1): app");
  const red = box.dod();
  await box.write("src/app.js", "// app\n");
  const heredoc = box.guard(
    "git add -A && git commit -m \"$(cat <<'EOF'\nfeat(U1): add app\n\nBody.\nEOF\n)\"",
  );
  const log = await box.read(buildLog);
  t.plan(7);
  t.assert.equal(
    early.stderr,
    "VOUCH-COMMIT-ORDER: Bash feat(U1): add app; the implementation needs contract(U1) with a passing DoD, then test(U1) with a failing DoD earlier on this branch\n",
  );
  t.assert.equal(early.exitCode, 2);
  t.assert.deepEqual([contract.status, contract.report.ok], [0, true]);
  t.assert.deepEqual([red.status, red.report.ok], [2, false]);
  t.assert.deepEqual([heredoc.exitCode, heredoc.stderr], [0, ""]);
  t.assert.equal((log.match(/<!-- dod -->/g) ?? []).length, 2);
  t.assert.match(log, /1 failing: app is missing/);
});

test("a push of the implementation waits for the DoD command to pass at its last code commit", async (t) => {
  const box = await gitBox(t);
  await box.write("src/types.js", "// contract\n");
  await box.prove(box.commit("contract(U1): app types"), 0);
  await box.write("tests/app.test.js", "// red\n");
  await box.prove(box.commit("test(U1): app"), 1);
  await box.write("src/app.js", "// app\n");
  box.commit("feat(U1): add app");
  const beforeGreen = box.guard(`git push -u origin ${branch}`);
  const green = box.dod();
  const push = box.guard(`git push -u origin ${branch}`, { harness: "codex" });
  const log = await box.read(buildLog);
  t.plan(4);
  t.assert.match(
    beforeGreen.stderr,
    /^VOUCH-COMMIT-EVIDENCE: Bash git push \([0-9a-f]{12} feat\(U1\): add app\); the implementation needs a passing DoD at its last code commit\n$/,
  );
  t.assert.deepEqual([green.status, green.report.ok], [0, true]);
  t.assert.deepEqual([push.exitCode, push.stderr], [0, ""]);
  t.assert.equal((log.match(/<!-- dod -->/g) ?? []).length, 1);
});

test("evidence of another Unit, another branch or a dirty tree does not satisfy the order", async (t) => {
  const box = await gitBox(t);
  await box.write("src/types.js", "// contract\n");
  await box.prove(box.commit("contract(U1): types"), 0);
  gitIn(box.root, "checkout", "-qb", "side");
  await box.write("tests/app.test.js", "// red on another branch\n");
  await box.prove(box.commit("test(U1): app"), 1);
  gitIn(box.root, "checkout", "-q", branch);
  await box.write("tests/app.test.js", "// red for U2\n");
  await box.prove(box.commit("test(U2): app"), 1);
  await box.write("tests/app.test.js", "// red for U1\n");
  await box.prove(box.commit("test(U1): app"), 1, { clean: false });
  await box.write("src/app.js", "// app\n");
  const blocked = box.guard("git add -A && git commit -m 'feat(U1): app'");
  await rm(box.path("src/app.js"));
  await box.write("tests/app.test.js", "// red for U1 again\n");
  await box.prove(box.commit("test(U1): app again"), 1);
  await box.write("src/app.js", "// app\n");
  const allowed = box.guard("git add -A && git commit -m 'feat(U1): app'");
  t.plan(3);
  t.assert.equal(blocked.exitCode, 2);
  t.assert.match(blocked.stderr, /^VOUCH-COMMIT-ORDER: Bash feat\(U1\): app; /);
  t.assert.deepEqual([allowed.exitCode, allowed.stderr], [0, ""]);
});

test("synthetic, forged and relabeled DoD records are not evidence", async (t) => {
  const box = await gitBox(t);
  await box.write("src/types.js", "// contract\n");
  const contract = box.commit("contract(U1): types");
  await box.write("tests/app.test.js", "// red\n");
  const red = box.commit("test(U1): app");
  await box.prove(contract, 0, { id: "evt_forged" });
  await box.prove(red, 1, { synthetic: true });
  await box.prove(contract, 0, { intent: "260929-other" });
  await box.write("src/app.js", "// app\n");
  const result = box.guard("git add -A && git commit -m 'feat(U1): app'");
  t.plan(3);
  t.assert.equal(result.exitCode, 2);
  t.assert.match(result.stderr, /^VOUCH-COMMIT-ORDER: /);
  t.assert.equal((await box.read(audit)).trim().split("\n").length, 5);
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
  t.assert.deepEqual([notes.exitCode, notes.stderr], [0, ""]);
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
  t.assert.match(
    push.stderr,
    /^VOUCH-COMMIT-TEST: Bash git push \([0-9a-f]{12} refactor\(U1\): tidy\); /,
  );
});
