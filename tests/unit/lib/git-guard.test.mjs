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
const refs =
  "for-each-ref --format=%(refname) refs/heads/main refs/remotes/*/main";
const log =
  "log --no-merges --no-renames --reverse --name-status -z HEAD --format=%x1e%H%x1f%s --not refs/heads/main";
const cached = "diff --no-renames --name-status -z --cached";
const worktree = "diff --no-renames --name-status -z HEAD";
const untracked = "ls-files -z --others --exclude-standard";

/**
 * A Git double keyed by the arguments after the lock option; records every call.
 * @param {Record<string,string|null>} overrides
 */
function fakeGit(overrides = {}) {
  /** @type {Record<string,string|null>} */ const answers = {
    "rev-parse --show-toplevel": "/project\n",
    [refs]: "refs/heads/main\n",
    "rev-parse --verify -q HEAD": `${sha("9")}\n`,
    [log]: "",
    "symbolic-ref --short -q HEAD": "vouch/260929-git\n",
    "rev-parse --abbrev-ref @{push}": "origin/vouch/260929-git\n",
    [cached]: "",
    [worktree]: "",
    [untracked]: "",
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
  const onMain = { "symbolic-ref --short -q HEAD": "main\n" };
  const upstreamMain = { "rev-parse --abbrev-ref @{push}": "origin/main\n" };
  const cases = [
    ["git push", onMain, true],
    ["git push origin HEAD", onMain, true],
    ["git push", upstreamMain, true],
    ["git push origin HEAD", upstreamMain, false],
    ["git push", {}, false],
    ["git push -u origin HEAD", {}, false],
    [
      "git push",
      {
        "symbolic-ref --short -q HEAD": null,
        "rev-parse --abbrev-ref @{push}": null,
      },
      false,
    ],
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
  const git = fakeGit({ "symbolic-ref --short -q HEAD": "main\n" });
  const result = await guardGit(
    bash("cd sub && git -C inner push"),
    context(undefined, { intent: "" }),
    git.execute,
  );
  t.plan(2);
  t.assert.equal(result.decision, "deny");
  t.assert.equal(
    git.calls.includes(
      "git -C sub -C inner symbolic-ref --short -q HEAD @/project",
    ),
    true,
    git.calls.join("\n"),
  );
});

test("commit subjects come from -m forms and the quoted here-document only", async (t) => {
  const code = { [cached]: "A\0src/app.js\0", [worktree]: "A\0src/app.js\0" };
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

test("commit changes widen to the worktree and new files when the command stages them", async (t) => {
  const staged = {
    [cached]: "M\0vouch/rules.md\0",
    [worktree]: "M\0vouch/rules.md\0",
    [untracked]: "src/new.js\0",
  };
  const noHead = {
    ...staged,
    "rev-parse --verify -q HEAD": null,
    [cached]: "A\0vouch/rules.md\0",
  };
  const cases = [
    ["git commit -m wip", staged, "allow"],
    ["git commit -am wip", staged, "deny"],
    ["git commit --all -m wip", staged, "deny"],
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
      { [cached]: "M\0README.md\0" },
      "VOUCH-COMMIT-UNIT: Bash docs(U9): x; U9 is not a Unit of the plan",
    ],
    [
      "git commit -m 'fix(U1): x'",
      { [cached]: "D\0tests/a.test.js\0" },
      "VOUCH-COMMIT-TEST: Bash fix(U1): x; test files change or disappear only in test(U1) commits",
    ],
    [
      "git commit -m 'feat(U2): x'",
      { [cached]: "A\0src/b.js\0" },
      "VOUCH-COMMIT-ORDER: Bash feat(U2): x; the implementation needs contract(U2) with a passing DoD, then test(U2) with a failing DoD earlier on this branch",
    ],
    ["git commit -m 'test(U1): x'", { [cached]: "D\0tests/a.test.js\0" }, ""],
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
  const code = { [cached]: "A\0src/app.js\0" };
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
    [commit, { [cached]: null }, {}],
    ["git commit -am 'feat(U1): impl'", { [untracked]: null }, {}],
    [commit, {}, { [audit]: "broken\n" }],
    ["git push origin vouch/260929-git", { [refs]: null }, {}],
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
  const answers = { [cached]: "A\0src/app.js\0" };
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
    fakeGit({ [cached]: "M\0README.md\0" }).execute,
  );
  t.plan(3);
  t.assert.match(reason(result), /^VOUCH-COMMIT-UNIT: Bash docs\(U+/);
  t.assert.equal(reason(result).length <= 600, true);
  t.assert.doesNotMatch(reason(result), /\n/);
});
