import { audit, branch, gitBox, gitIn } from "../helpers/git-guard.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";

// Git push and pull request merge checks through the registered guard: docs/development/git-guard.md.

test("pushes to main and pull request merges deny in both harnesses with or without an Intent, and other pushes pass", async (t) => {
  const box = await gitBox(t);
  const denied: [string, "claude" | "codex", string | undefined][] = [
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
  const merge = box.guard("gh pr merge 23 --squash", { harness: "codex" });
  gitIn(box.root, "checkout", "-q", "main");
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
  gitIn(
    box.root,
    "init",
    "-q",
    "--initial-branch=main",
    box.path("vendor/lib"),
  );
  await box.write("vendor/lib/a.js", "// vendored\n");
  const nested = box.guard(
    "git -C vendor/lib add -A && git -C vendor/lib commit -m 'feat(U1): vendored'",
  );
  const nestedPush = box.guard("cd vendor/lib && git push");
  await box.write(audit, "broken\n");
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

test("a push of another branch checks that branch's commits, not the checked-out one", async (t) => {
  const box = await gitBox(t);
  gitIn(box.root, "checkout", "-qb", "side");
  await box.write("src/draft.js", "// draft\n");
  box.commit("wip");
  gitIn(box.root, "checkout", "-q", branch);
  const other = box.guard("git push origin side:topic");
  const own = box.guard(`git push origin ${branch}`);
  t.plan(2);
  t.assert.match(
    other.stderr,
    /^VOUCH-COMMIT-TYPE: Bash git push \([0-9a-f]{12} wip\); /,
  );
  t.assert.deepEqual([own.exitCode, own.stderr], [0, ""]);
});
