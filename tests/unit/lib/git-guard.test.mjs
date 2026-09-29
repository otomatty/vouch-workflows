import { test } from "node:test";
import { createIntentAuditStore } from "../../../core/hooks/lib/audit.mjs";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import { guardGit } from "../../../core/hooks/lib/git-guard.mjs";
import { planned } from "../../helpers/intent-review.mjs";
import { memoryFiles } from "../../helpers/runtime.mjs";

// Git push and commit checks: docs/development/git-guard.md.
const intent = "260929-git";
const artifact = `vouch/intents/${intent}/intent.md`;
const audit = `vouch/intents/${intent}/audit/events.jsonl`;
const plan = planned([
  ["U1", "L: small", "not-required: none"],
  ["U2", "L: small", "not-required: none"],
]);
const sha = (/** @type {string} */ c) => c.repeat(40);
const log =
  "log --no-merges --no-renames --reverse --name-status -z HEAD --format=%x1e%H%x1f%s --not --branches=[m]ain --remotes=*/[m]ain --";
/** The log of another pushed source. @param {string} rev */
const logOf = (rev) => log.replace(" HEAD ", ` ${rev} `);
const status = "status --porcelain -z -uall --no-renames";
const branch = "status -b --porcelain -z -uno";

/**
 * A Git double keyed by the arguments after the lock option; records every call.
 * @param {Record<string,string|null>} overrides
 */
function fakeGit(overrides = {}) {
  /** @type {Record<string,string|null>} */ const answers = {
    "rev-parse --show-toplevel": "/project\n",
    "rev-parse --verify -q HEAD": `${sha("9")}\n`,
    [log]: "",
    [branch]: "## vouch/260929-git...origin/vouch/260929-git [ahead 1]\0",
    [status]: "",
    ...overrides,
  };
  /** @type {string[]} */ const calls = [];
  /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').SpawnPort} */
  const execute = (file, args, options) => {
    const key = args.slice(1).join(" ");
    calls.push(`${file} ${key} @${options.cwd}`);
    const steps = key.match(/^(?:-C \S+ )*/)?.[0] ?? "";
    const answer = answers[key.slice(steps.length)];
    return answer === null || answer === undefined
      ? { status: 128, stdout: "" }
      : { status: 0, stdout: answer };
  };
  return { execute, calls };
}

/**
 * @param {Record<string,string>} files
 * @param {{intent?:string,harness?:'claude'|'codex',inside?:string|null}} [options]
 * @returns {import('../../../core/hooks/lib/contracts.mjs').ReadyHookContext}
 */
function context(files = { [artifact]: plan }, options = {}) {
  const store = memoryFiles(files);
  const scope = options.intent ?? intent;
  const inside = options.inside === undefined ? "" : options.inside;
  return {
    projectRoot: "/project",
    harness: options.harness ?? "claude",
    ...(scope ? { intent: scope } : {}),
    generation: "test",
    now: () => "2026-09-29T00:00:00Z",
    newId,
    readText: store.readText,
    locate: async (path) => ({
      inside: path === "/project" ? inside : null,
      contains: false,
      kind: "directory",
      links: 0,
    }),
    ...(scope ? { audit: createIntentAuditStore(store, scope) } : {}),
  };
}

/** @param {string} command @param {string} [tool] @returns {import('../../../core/hooks/lib/contracts.mjs').HookInput} */
const bash = (command, tool = "Bash") => ({
  hook_event_name: "PreToolUse",
  session_id: "s-git",
  cwd: "/project",
  tool_name: tool,
  tool_input: { command },
});

/** @param {unknown} value A validated input shape the test builds by spreading another. */
const input = (value) =>
  /** @type {import('../../../core/hooks/lib/contracts.mjs').HookInput} */ (
    value
  );

/** @param {import('../../../core/hooks/lib/contracts.mjs').HookResult} result */
const reason = (result) => (result.decision === "deny" ? result.reason : "");

test("guardGit ignores other events, tools and malformed commands without running Git", async (t) => {
  const git = fakeGit();
  const ctx = context();
  const results = [
    await guardGit(
      input({
        ...bash("git push origin main"),
        hook_event_name: "PostToolUse",
        tool_response: null,
      }),
      ctx,
      git.execute,
    ),
    await guardGit(bash("git push origin main", "Write"), ctx, git.execute),
    await guardGit(
      input({ ...bash(""), tool_input: { command: 5 } }),
      ctx,
      git.execute,
    ),
    await guardGit(bash("echo git push origin main"), ctx, git.execute),
  ];
  t.plan(results.length + 1);
  for (const result of results)
    t.assert.deepEqual(result, { decision: "allow" });
  t.assert.deepEqual(git.calls, []);
});

test("pushes that name, spell or default to main deny with or without an Intent", async (t) => {
  const denied = [
    "git push origin main",
    "git push -u origin HEAD:main",
    "git push origin +topic:refs/heads/main",
    "git push origin :main",
    "git push --delete origin main",
    "git push -f --repo=origin main",
    "git push --repo origin main",
    "git push -o ci.skip origin main",
    "git push --all origin",
    "git push --mirror",
    "git push origin 'refs/heads/*:refs/heads/*'",
    "git status && git push origin main",
    "git -c push.default=current -C .. push origin main",
  ];
  t.plan(denied.length * 2);
  for (const command of denied)
    for (const scope of [intent, ""]) {
      const git = fakeGit();
      t.assert.match(
        reason(
          await guardGit(
            bash(command),
            context(undefined, { intent: scope }),
            git.execute,
          ),
        ),
        /^VOUCH-GIT-PUSH: Bash git push .*; (?:main is protected|all branches include a protected branch); it changes only through a pull request a person merges$/,
        `${command} ${scope}`,
      );
    }
});

test("pushes of the current or default branch resolve it through Git", async (t) => {
  const onMain = { [branch]: "## main\0" };
  const upstreamMain = { [branch]: "## vouch/260929-git...origin/main\0" };
  const cases = [
    ["git push", onMain, true],
    ["git push origin HEAD", onMain, true],
    ["git push", upstreamMain, true],
    ["git push origin HEAD", upstreamMain, false],
    ["git push", {}, false],
    ["git push -u origin HEAD", {}, false],
    ["git push", { [branch]: null }, false],
  ];
  t.plan(cases.length);
  for (const [command, overrides, deny] of cases) {
    const git = fakeGit(/** @type {Record<string,string|null>} */ (overrides));
    const result = await guardGit(
      bash(`${command}`),
      context(undefined, { intent: "" }),
      git.execute,
    );
    t.assert.equal(
      result.decision,
      deny ? "deny" : "allow",
      `${command} ${JSON.stringify(overrides)}`,
    );
  }
});

test("dry runs, tags and other branches push without a protected destination", async (t) => {
  const allowed = [
    "git push -n origin main",
    "git push --dry-run --all",
    "git push --tags",
    "git push origin v1.0",
    "git push origin refs/tags/main",
    "git push -u origin vouch/260929-git",
    "git push origin topic:vouch/other",
  ];
  t.plan(allowed.length);
  for (const command of allowed)
    t.assert.deepEqual(
      await guardGit(
        bash(command),
        context(undefined, { intent: "" }),
        fakeGit().execute,
      ),
      { decision: "allow" },
      command,
    );
});

test("destinations and directories built at run time cannot be verified", async (t) => {
  const cases = [
    'git push origin "$BRANCH"',
    "git push origin $(git branch --show-current)",
    'cd "$DIR" && git push',
    "cd && git push",
    "cd - && git push",
    "git --git-dir=.git push",
    "git --work-tree .. push",
  ];
  t.plan(cases.length);
  for (const command of cases)
    t.assert.match(
      reason(await guardGit(bash(command), context(), fakeGit().execute)),
      /^VOUCH-GIT-PUSH: Bash git push.*; the destination cannot be verified$/,
      command,
    );
});

test("git runs from the input cwd with fixed cd and -C steps", async (t) => {
  const git = fakeGit({ [branch]: "## No commits yet on main\0" });
  const result = await guardGit(
    bash("cd sub && git -C inner push"),
    context(undefined, { intent: "" }),
    git.execute,
  );
  t.plan(2);
  t.assert.equal(result.decision, "deny");
  t.assert.equal(
    git.calls.includes(
      "git -C sub -C inner status -b --porcelain -z -uno @/project",
    ),
    true,
    git.calls.join("\n"),
  );
});

test("commit subjects come from -m forms and the quoted here-document only", async (t) => {
  const code = { [status]: "A  src/app.js\0" };
  const typed = [
    "git commit -m wip",
    "git commit -am wip",
    "git commit --message wip",
    "git commit --message=wip",
    "git commit -q -m 'wip' -m 'feat(U1): body'",
    "git commit -m \"$(cat <<'EOF'\nwip\n\nfeat(U1): body\nEOF\n)\"",
    'git commit -m "$(cat <<EOF\nwip\nEOF\n)"',
  ];
  const unread = [
    "git commit",
    "git commit -F message.txt",
    'git commit -m "$(date)"',
    "git commit -m \"$(cat <<'EOF'\n$HOME\nEOF\n)\"",
    "git commit --fixup HEAD",
  ];
  t.plan(typed.length + unread.length);
  for (const command of typed)
    t.assert.match(
      reason(await guardGit(bash(command), context(), fakeGit(code).execute)),
      /^VOUCH-COMMIT-TYPE: Bash wip; code changes need a "<type>\(<Unit>\): " subject with a type in contract, test, feat, fix, refactor, docs, chore$/,
      command,
    );
  for (const command of unread)
    t.assert.deepEqual(
      await guardGit(bash(command), context(), fakeGit(code).execute),
      { decision: "allow" },
      command,
    );
});

test("commit changes widen to the worktree with -a and to new files after an add", async (t) => {
  const staged = {
    [status]: "M  vouch/rules.md\0?? src/new.js\0",
  };
  const tracked = {
    [status]: "M  vouch/rules.md\0 M src/app.js\0?? src/new.js\0",
  };
  const noHead = {
    ...staged,
    "rev-parse --verify -q HEAD": null,
    [log]: null,
  };
  const cases = [
    ["git commit -m wip", staged, "allow"],
    ["git commit -am wip", staged, "allow"],
    ["git commit --all -m wip", staged, "allow"],
    ["git commit -am wip", tracked, "deny"],
    ["git commit -m wip", tracked, "allow"],
    ["git add -A && git commit -m wip", staged, "deny"],
    ["git rm x && git commit -m wip", staged, "deny"],
    ["git add -A; git commit -m wip", noHead, "deny"],
    ["git commit -m wip && git add -A", staged, "allow"],
  ];
  t.plan(cases.length);
  for (const [command, answers, decision] of cases) {
    const result = await guardGit(
      bash(`${command}`),
      context(),
      fakeGit(/** @type {Record<string,string|null>} */ (answers)).execute,
    );
    t.assert.equal(result.decision, decision, `${command}`);
  }
});

test("commit rules report unit, test and order in the registry wording", async (t) => {
  const cases = [
    [
      "git commit -m 'docs(U9): x'",
      { [status]: "M  README.md\0" },
      "VOUCH-COMMIT-UNIT: Bash docs(U9): x; U9 is not a Unit of the plan",
    ],
    [
      "git commit -m 'fix(U1): x'",
      { [status]: "D  tests/a.test.js\0" },
      "VOUCH-COMMIT-TEST: Bash fix(U1): x; test files change or disappear only in test(U1) commits",
    ],
    [
      "git commit -m 'feat(U2): x'",
      { [status]: "A  src/b.js\0" },
      "VOUCH-COMMIT-ORDER: Bash feat(U2): x; the implementation needs contract(U2) with a passing DoD, then test(U2) with a failing DoD earlier on this branch",
    ],
    ["git commit -m 'test(U1): x'", { [status]: "D  tests/a.test.js\0" }, ""],
  ];
  t.plan(cases.length);
  for (const [command, answers, expected] of cases)
    t.assert.equal(
      reason(
        await guardGit(
          bash(`${command}`),
          context(),
          fakeGit(/** @type {Record<string,string>} */ (answers)).execute,
        ),
      ),
      expected,
    );
});

test("order checks apply only to the configured Intent's project repository", async (t) => {
  const code = { [status]: "A  src/app.js\0" };
  const command = bash("git commit -m 'feat(U1): impl'");
  t.plan(4);
  t.assert.deepEqual(
    await guardGit(
      command,
      context(undefined, { intent: "" }),
      fakeGit(code).execute,
    ),
    { decision: "allow" },
  );
  t.assert.deepEqual(
    await guardGit(
      command,
      context(undefined, { inside: "sub" }),
      fakeGit(code).execute,
    ),
    { decision: "allow" },
  );
  t.assert.deepEqual(
    await guardGit(
      command,
      context(undefined, { inside: null }),
      fakeGit(code).execute,
    ),
    { decision: "allow" },
  );
  t.assert.deepEqual(
    await guardGit(
      command,
      context(),
      fakeGit({ ...code, "rev-parse --show-toplevel": null }).execute,
    ),
    { decision: "allow" },
  );
});

test("unreadable history, plan, audit or changes deny commits and pushes", async (t) => {
  const commit = "git commit -m 'feat(U1): impl'";
  const cases = [
    [commit, { [log]: null }, {}],
    [commit, { [status]: null }, {}],
    ["git commit -am 'feat(U1): impl'", { [status]: null }, {}],
    [commit, {}, { [audit]: "broken\n" }],
    ["git push origin vouch/260929-git", { [log]: null }, {}],
    ["git push origin vouch/260929-git", {}, { [audit]: "broken\n" }],
  ];
  t.plan(cases.length);
  for (const [command, answers, files] of cases)
    t.assert.match(
      reason(
        await guardGit(
          bash(`${command}`),
          context({
            [artifact]: plan,
            .../** @type {Record<string,string>} */ (files),
          }),
          fakeGit(/** @type {Record<string,string|null>} */ (answers)).execute,
        ),
      ),
      /^VOUCH-GIT-UNVERIFIED: Bash .+; the (?:branch history, the plan or the audit|changes) could not be read$/,
      `${command} ${JSON.stringify(answers)}`,
    );
});

test("a missing or invalid plan names the Unit as unknown", async (t) => {
  const answers = { [status]: "A  src/app.js\0" };
  const command = bash("git commit -m 'contract(U1): types'");
  t.plan(2);
  t.assert.match(
    reason(await guardGit(command, context({}), fakeGit(answers).execute)),
    /^VOUCH-COMMIT-UNIT: /,
  );
  t.assert.match(
    reason(
      await guardGit(
        command,
        context({ [artifact]: "---\nstatus: draft\n---\n# No plan\n" }),
        fakeGit(answers).execute,
      ),
    ),
    /^VOUCH-COMMIT-UNIT: /,
  );
});

test("pushes check every branch commit and name the first that breaks a rule", async (t) => {
  const history = `\x1e${sha("1")}\x1fcontract(U1): types\0\nA\0src/types.js\0\x1e${sha("2")}\x1fwip\x07 ${"x".repeat(300)}\0\nA\0src/app.js\0\x1e${sha("3")}\x1ffeat(U1): impl\0\nA\0src/app.js\0`;
  const result = await guardGit(
    bash("git push origin vouch/260929-git"),
    context(),
    fakeGit({ [log]: history }).execute,
  );
  const clean = `\x1e${sha("1")}\x1fchore: notes\0\nA\0vouch/notes.md\0`;
  t.plan(3);
  t.assert.match(
    reason(result),
    new RegExp(
      `^VOUCH-COMMIT-TYPE: Bash git push \\(${"2".repeat(12)} wip\\? x+; code changes`,
    ),
  );
  t.assert.equal(reason(result).length < 460, true, "shown text is bounded");
  t.assert.deepEqual(
    await guardGit(
      bash("git push origin vouch/260929-git"),
      context(),
      fakeGit({ [log]: clean }).execute,
    ),
    { decision: "allow" },
  );
});

test("both harnesses route their shell tool through the same checks", async (t) => {
  t.plan(2);
  for (const harness of /** @type {const} */ (["claude", "codex"]))
    t.assert.match(
      reason(
        await guardGit(
          bash("git push origin main"),
          context(undefined, { harness }),
          fakeGit().execute,
        ),
      ),
      /^VOUCH-GIT-PUSH: /,
    );
});

test("deny reasons stay on one bounded line whatever the subject spells", async (t) => {
  const unit = "U".repeat(2000);
  const result = await guardGit(
    bash(`git commit -m 'docs(${unit}): x'`),
    context(),
    fakeGit({ [status]: "M  README.md\0" }).execute,
  );
  t.plan(3);
  t.assert.match(reason(result), /^VOUCH-COMMIT-UNIT: Bash docs\(U+/);
  t.assert.equal(reason(result).length <= 600, true);
  t.assert.doesNotMatch(reason(result), /\n/);
});

test("pull request merges through the GitHub CLI deny with or without an Intent", async (t) => {
  const denied = [
    "gh pr merge 23 --squash",
    "gh pr merge --auto --merge",
    "git push origin topic && gh pr merge",
  ];
  const allowed = ["gh pr view 23", "gh pr create --fill", "git merge main"];
  t.plan(denied.length * 2 + allowed.length);
  for (const command of denied)
    for (const scope of [intent, ""])
      t.assert.match(
        reason(
          await guardGit(
            bash(command),
            context(undefined, { intent: scope }),
            fakeGit().execute,
          ),
        ),
        /^VOUCH-GIT-MERGE: Bash gh pr merge.*; a person merges the pull request after reading the Brief$/,
        `${command} ${scope}`,
      );
  for (const command of allowed)
    t.assert.deepEqual(
      await guardGit(bash(command), context(), fakeGit().execute),
      { decision: "allow" },
      command,
    );
});

test("push arguments keep the remote, option values and other programs apart from destinations", async (t) => {
  const onMain = { [branch]: "## main\0" };
  /** @type {[string,Record<string,string|null>,string][]} */
  const cases = [
    ["git push main", {}, "allow"],
    ["git push origin topic -o main", {}, "allow"],
    ["git push origin +main", {}, "deny"],
    ["git push origin HEAD topic", onMain, "deny"],
    ["git push origin topic", onMain, "allow"],
    ['FOO="$HOME" git push origin topic', {}, "allow"],
    ["cd sub-dir && git push", {}, "allow"],
    ["docker push origin main", {}, "allow"],
    ["echo pr merge && hub pr merge", {}, "allow"],
    ["git", {}, "allow"],
  ];
  t.plan(cases.length + 1);
  for (const [command, answers, decision] of cases)
    t.assert.equal(
      (
        await guardGit(
          bash(command),
          context(undefined, { intent: "" }),
          fakeGit(answers).execute,
        )
      ).decision,
      decision,
      command,
    );
  t.assert.equal(
    reason(
      await guardGit(
        bash("git push origin main"),
        context(),
        fakeGit().execute,
      ),
    ),
    "VOUCH-GIT-PUSH: Bash git push origin main; main is protected; it changes only through a pull request a person merges",
  );
});

test("commit subjects and staged columns follow git's own option spelling", async (t) => {
  const stagedVouch = {
    [status]: "M  vouch/rules.md\0 M src/app.js\0?? tests/Data.test.js\0",
  };
  /** @type {[string,Record<string,string>,RegExp][]} */
  const cases = [
    ["git commit --amend -m wip", stagedVouch, /^$/],
    ["git commit -a -m 'refactor(U1): x'", stagedVouch, /^$/],
    [
      "git commit -m \"$(cat << 'EOF'\nwip\nEOF\n)\"",
      { [status]: "A  src/a.js\0" },
      /^VOUCH-COMMIT-TYPE: Bash wip; /,
    ],
    [
      "git commit -m 'refactor(U1): x'",
      { [status]: "M  src/a.js\0M  tests/a.test.js\0" },
      /^VOUCH-COMMIT-TEST: /,
    ],
  ];
  t.plan(cases.length + 1);
  for (const [command, answers, expected] of cases)
    t.assert.match(
      reason(
        await guardGit(bash(command), context(), fakeGit(answers).execute),
      ),
      expected,
      command,
    );
  t.assert.equal(
    reason(
      await guardGit(
        bash("gh pr merge 23 --squash"),
        context(),
        fakeGit().execute,
      ),
    ),
    "VOUCH-GIT-MERGE: Bash gh pr merge 23 --squash; a person merges the pull request after reading the Brief",
  );
});

test("a push checks each commit only against the commits before it", async (t) => {
  const contract = sha("1");
  const red = sha("2");
  /** @param {string} commit @param {number} exit */
  const record = (commit, exit) => {
    const output = {
      path: "build-log.md",
      sha256: (exit ? "e" : "f").repeat(64),
    };
    return JSON.stringify({
      id: newId(
        commit,
        JSON.stringify(["hook.check", "dod", intent, output.sha256]),
      ),
      v: 1,
      type: "hook.check",
      ts: "2026-09-29T00:00:00Z",
      actor: "hook",
      intent,
      check: "dod",
      result: exit ? "fail" : "pass",
      duration_ms: 1,
      commit,
      clean: true,
      commands: [
        {
          target: "t",
          command: "c",
          cwd: ".",
          result: exit ? "fail" : "pass",
          duration_ms: 1,
          exit_code: exit,
        },
      ],
      output,
    });
  };
  const files = {
    [artifact]: plan,
    [audit]: `${record(contract, 0)}\n${record(red, 1)}\n${record(sha("3"), 0)}\n`,
  };
  /** @param {string[][]} commits */
  const history = (commits) =>
    commits
      .map(([c, subject, path]) => `\x1e${c}\x1f${subject}\0\nA\0${path}\0`)
      .join("");
  const ordered = history([
    [sha("0"), "wip", "vouch/notes.md"],
    [contract, "contract(U1): types", "src/types.js"],
    [red, "test(U1): red", "tests/a.test.js"],
    [sha("3"), "feat(U1): app", "src/app.js"],
  ]);
  const reversed = history([
    [sha("3"), "feat(U1): app", "src/app.js"],
    [contract, "contract(U1): types", "src/types.js"],
    [red, "test(U1): red", "tests/a.test.js"],
  ]);
  const push = bash("git push origin vouch/260929-git");
  t.plan(2);
  t.assert.deepEqual(
    await guardGit(push, context(files), fakeGit({ [log]: ordered }).execute),
    { decision: "allow" },
  );
  t.assert.match(
    reason(
      await guardGit(
        push,
        context(files),
        fakeGit({ [log]: reversed }).execute,
      ),
    ),
    /^VOUCH-COMMIT-ORDER: Bash git push \(3{12} feat\(U1\): app\); /,
  );
});

test("a push with an implementation needs a passing DoD at its last code commit", async (t) => {
  /** @param {string} commit @param {number} exit */
  const record = (commit, exit) => {
    const output = { path: "build-log.md", sha256: `${exit}`.repeat(64) };
    return `${JSON.stringify({
      id: newId(
        commit,
        JSON.stringify(["hook.check", "dod", intent, output.sha256]),
      ),
      v: 1,
      type: "hook.check",
      ts: "2026-09-29T00:00:00Z",
      actor: "hook",
      intent,
      check: "dod",
      result: exit ? "fail" : "pass",
      duration_ms: 1,
      commit,
      clean: true,
      commands: [
        {
          target: "t",
          command: "c",
          cwd: ".",
          result: exit ? "fail" : "pass",
          duration_ms: 1,
          exit_code: exit,
        },
      ],
      output,
    })}\n`;
  };
  const history = `\x1e${sha("1")}\x1ftest(U1): red\0\nA\0tests/a.test.js\0\x1e${sha("2")}\x1ffix(U1): repair\0\nM\0src/a.js\0\x1e${sha("5")}\x1fdocs(U1): log\0\nM\0vouch/log.md\0`;
  const push = bash("git push origin vouch/260929-git");
  const red = { [artifact]: plan, [audit]: record(sha("1"), 1) };
  const green = {
    ...red,
    [audit]: `${record(sha("1"), 1)}${record(sha("2"), 0)}`,
  };
  t.plan(2);
  t.assert.equal(
    reason(
      await guardGit(push, context(red), fakeGit({ [log]: history }).execute),
    ),
    `VOUCH-COMMIT-EVIDENCE: Bash git push (${"2".repeat(12)} fix(U1): repair); the implementation needs a passing DoD at its last code commit`,
  );
  t.assert.deepEqual(
    await guardGit(push, context(green), fakeGit({ [log]: history }).execute),
    { decision: "allow" },
  );
});

test("a push checks the history of each source it sends, not only HEAD", async (t) => {
  const side = `\x1e${sha("7")}\x1fwip\0\nA\0src/draft.js\0`;
  const answers = { [log]: "", [logOf("side")]: side };
  const denied = [
    "git push origin side:topic",
    "git push origin +side:topic",
    "git push origin side",
    "git push origin HEAD:topic side:other",
  ];
  const run = (/** @type {string} */ command) =>
    guardGit(bash(command), context(), fakeGit(answers).execute);
  t.plan(denied.length + 3);
  for (const command of denied)
    t.assert.match(
      reason(await run(command)),
      new RegExp(
        `^VOUCH-COMMIT-TYPE: Bash git push \\(${"7".repeat(12)} wip\\); `,
      ),
      command,
    );
  t.assert.deepEqual(await run("git push origin HEAD:topic :old"), {
    decision: "allow",
  });
  const calls = fakeGit(answers);
  await guardGit(bash("git push origin :old"), context(), calls.execute);
  t.assert.equal(
    calls.calls.some((call) => call.includes(" log ")),
    false,
  );
  t.assert.match(
    reason(await run("git push origin +-x:topic")),
    /^VOUCH-GIT-UNVERIFIED: Bash git push origin \+-x:topic; the branch history/,
  );
});
