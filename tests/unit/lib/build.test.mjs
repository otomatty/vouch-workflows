import { test } from "node:test";
import { createIntentAuditStore } from "../../../core/hooks/lib/audit.mjs";
import { guardBuild } from "../../../core/hooks/lib/build.mjs";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import { evidenced } from "../../helpers/approval.mjs";
import { planned } from "../../helpers/intent-review.mjs";
import { memoryFiles } from "../../helpers/runtime.mjs";

const intent = "260929-plan";
const artifact = `vouch/intents/${intent}/intent.md`;
const audit = `vouch/intents/${intent}/audit/events.jsonl`;
const draft = planned();
const approved = draft.replace("status: draft", "status: approved");
/** @param {object[]} events */
const jsonl = (events) =>
  events.map((event) => `${JSON.stringify(event)}\n`).join("");
const { gate, approval } = evidenced(draft, { intent });

/**
 * @param {Record<string,string>} files
 * @param {{intent?:string,harness?:'claude'|'codex',audit?:import('../../../core/hooks/lib/contracts.mjs').AuditStore,locate?:import('../../../core/hooks/lib/runtime-contracts.mjs').FileStore['locate'],readText?:(path:string)=>Promise<string|null>}} [options]
 * @returns {import('../../../core/hooks/lib/contracts.mjs').ReadyHookContext}
 */
function context(files, options = {}) {
  const store = memoryFiles(files);
  const scope = options.intent ?? intent;
  return {
    projectRoot: "/project",
    harness: options.harness ?? "claude",
    ...(scope ? { intent: scope } : {}),
    generation: "test",
    now: () => "2026-09-29T00:00:05Z",
    newId,
    readText: options.readText ?? store.readText,
    locate: options.locate ?? store.locate,
    ...(scope
      ? { audit: options.audit ?? createIntentAuditStore(store, scope) }
      : {}),
  };
}

/** @param {string} tool @param {Record<string,unknown>} toolInput @returns {import('../../../core/hooks/lib/contracts.mjs').HookInput} */
const tool = (tool, toolInput) => ({
  hook_event_name: "PreToolUse",
  session_id: "s-build",
  cwd: "/project",
  tool_name: tool,
  tool_input: toolInput,
});
/** @param {string} path */
const write = (path) => tool("Write", { file_path: path, content: "x\n" });
/** @param {...string} lines */
const patch = (...lines) =>
  tool("apply_patch", {
    command: ["*** Begin Patch", ...lines, "*** End Patch", ""].join("\n"),
  });

test("implementation writes wait for an approved plan with evidence", async (t) => {
  const approvedFiles = {
    [artifact]: approved,
    [audit]: jsonl([gate, approval]),
  };
  const cases = [
    [{ [artifact]: draft, [audit]: jsonl([gate, approval]) }, /draft/],
    [{ [audit]: jsonl([gate, approval]) }, /no intent\.md/],
    [{ [artifact]: "# no frontmatter\n" }, /unsupported/],
    [{ [artifact]: approved }, /no approval evidence/],
    [{ [artifact]: approved, [audit]: jsonl([gate]) }, /no approval evidence/],
    [
      {
        [artifact]: `${approved}edited outside the harness\n`,
        [audit]: jsonl([gate, approval]),
      },
      /no approval evidence/,
    ],
    [
      {
        [artifact]: approved,
        [audit]: jsonl([gate, { ...approval, synthetic: true }]),
      },
      /no approval evidence/,
    ],
  ];
  t.plan(cases.length * 2 + 3);
  for (const [files, detail] of cases) {
    const result = await guardBuild(
      write("src/app.js"),
      context(/** @type {Record<string,string>} */ (files)),
    );
    t.assert.equal(result.decision, "deny");
    t.assert.match(
      result.reason ?? "",
      new RegExp(
        `^VOUCH-BUILD-UNAPPROVED: Write src/app\\.js; .*${/** @type {RegExp} */ (detail).source}`,
      ),
    );
  }
  t.assert.deepEqual(
    await guardBuild(write("src/app.js"), context(approvedFiles)),
    { decision: "allow" },
  );
  t.assert.deepEqual(
    await guardBuild(
      tool("Edit", {
        file_path: "README.md",
        old_string: "a",
        new_string: "b",
      }),
      context(approvedFiles),
    ),
    { decision: "allow" },
  );
  t.assert.deepEqual(
    await guardBuild(
      write(`vouch/intents/${intent}/build-log.md`),
      context(approvedFiles),
    ),
    { decision: "allow" },
  );
});

test("vouch artifacts before approval, outside paths and unscoped sessions are not Build starts", async (t) => {
  const files = { [artifact]: draft };
  const allowed = [
    [write(artifact), context(files)],
    [write(`vouch/intents/${intent}/decisions.md`), context(files)],
    [write(`vouch/intents/${intent}/design.md`), context(files)],
    [write("vouch/rules.md"), context(files)],
    [write("vouch/knowledge/codekb/app.md"), context(files)],
    [write("vouch/intents/260930-next/build-log.md"), context(files)],
    [
      write("/elsewhere/app.js"),
      context(files, {
        locate: async () => ({
          inside: null,
          contains: false,
          kind: "missing",
          links: 0,
        }),
      }),
    ],
    [write("src/app.js"), context(files, { intent: "" })],
    [tool("Bash", { command: "echo x > src/app.js" }), context(files)],
    [
      tool("Agent", { prompt: "build it", subagent_type: "general-purpose" }),
      context(files),
    ],
    [tool("Write", { file_path: 7 }), context(files)],
    [
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "s",
        cwd: "/project",
        prompt: "build",
      },
      context(files),
    ],
    [
      patch("*** Update File: vouch/rules.md", "@@", "-a", "+b"),
      context(files, { harness: "codex" }),
    ],
  ];
  t.plan(allowed.length);
  for (const [input, ctx] of allowed)
    t.assert.deepEqual(
      await guardBuild(
        /** @type {import('../../../core/hooks/lib/contracts.mjs').HookInput} */ (
          input
        ),
        /** @type {import('../../../core/hooks/lib/contracts.mjs').ReadyHookContext} */ (
          ctx
        ),
      ),
      { decision: "allow" },
      JSON.stringify(input),
    );
});

test("Build and Verify artifacts, patches and moves out of vouch are Build starts", async (t) => {
  const files = { [artifact]: draft };
  const denied = [
    [write(`vouch/intents/${intent}/build-log.md`), "claude"],
    [write(`vouch/intents/${intent}/review.md`), "claude"],
    [write(`./VOUCH/Intents/${intent}/Build-Log.md`), "claude"],
    [write(".claude/skills/local/SKILL.md"), "claude"],
    [patch("*** Add File: src/new.js", "+x"), "codex"],
    [
      patch(
        `*** Update File: vouch/intents/${intent}/decisions.md`,
        "@@",
        "+x",
        "*** Delete File: src/old.js",
      ),
      "codex",
    ],
    [
      patch(
        "*** Update File: vouch/notes.md",
        "*** Move to: src/notes.md",
        "@@",
        "+x",
      ),
      "codex",
    ],
  ];
  t.plan(denied.length * 2);
  for (const [input, harness] of denied) {
    const result = await guardBuild(
      /** @type {import('../../../core/hooks/lib/contracts.mjs').HookInput} */ (
        input
      ),
      context(files, { harness: /** @type {'claude'|'codex'} */ (harness) }),
    );
    t.assert.equal(result.decision, "deny", JSON.stringify(input));
    t.assert.match(
      result.reason ?? "",
      /^VOUCH-BUILD-UNAPPROVED: (?:Write|apply_patch) /,
    );
  }
});

test("unreadable evidence denies instead of failing open", async (t) => {
  const cases = [
    context(
      { [artifact]: approved },
      {
        readText: async () => {
          throw new Error("FS-UTF8: invalid text");
        },
      },
    ),
    context({ [artifact]: approved, [audit]: "broken\n" }),
    context(
      { [artifact]: approved },
      {
        audit: {
          append: async () => "duplicate",
          find: async () => undefined,
        },
      },
    ),
  ];
  t.plan(cases.length);
  for (const ctx of cases)
    t.assert.match(
      (await guardBuild(write("src/app.js"), ctx)).reason ?? "",
      /^VOUCH-BUILD-UNAPPROVED: Write src\/app\.js; .*unreadable/,
    );
});

test("only file edit tools, only the Intent's own artifacts, and a sanitized target are considered", async (t) => {
  const files = { [artifact]: draft };
  const edit = await guardBuild(
    tool("Edit", { file_path: "src/app.js", old_string: "a", new_string: "b" }),
    context(files),
  );
  const shell = await guardBuild(
    tool("Bash", { command: "true", file_path: "src/app.js" }),
    context(files),
  );
  const nested = await guardBuild(
    write(`vouch/intents/${intent}/notes/build-log.md`),
    context(files),
  );
  const control = await guardBuild(
    write(`src/a\u0007${"x".repeat(300)}.js`),
    context(files),
  );
  const approvedFiles = { [artifact]: approved, [audit]: jsonl([gate]) };
  const missing = await guardBuild(write("src/app.js"), context(approvedFiles));
  t.plan(6);
  t.assert.match(
    edit.reason ?? "",
    /^VOUCH-BUILD-UNAPPROVED: Edit src\/app\.js; /,
  );
  t.assert.deepEqual(shell, { decision: "allow" });
  t.assert.deepEqual(nested, { decision: "allow" });
  t.assert.match(
    control.reason ?? "",
    /^VOUCH-BUILD-UNAPPROVED: Write src\/a\?x{194}; /,
  );
  t.assert.equal(
    missing.reason,
    `VOUCH-BUILD-UNAPPROVED: Write src/app.js; implementation waits for an approved plan (no approval evidence for revision ${gate.revision?.sha256.slice(0, 12)})`,
  );
  t.assert.match(
    (await guardBuild(write("src/app.js"), context({}))).reason ?? "",
    /\(no intent\.md\)$/,
  );
});
