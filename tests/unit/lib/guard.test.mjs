import { link, mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { guardWrites } from "../../../core/hooks/lib/guard.mjs";
import { fakeClock, sandbox } from "../../helpers/runtime.mjs";

const intent = "260929-guard";
const draft = "---\nstatus: draft\n---\n# Guarded draft\n\nAC-1: keep it.\n";
const approvedText = draft.replace("draft", "approved");
const record = `${JSON.stringify({ id: "evt_x", v: 1, type: "session.started", ts: "2026-09-29T00:00:00.000Z", actor: "hook", session: "s" })}\n`;

/** @param {import('node:test').TestContext} t @param {'claude'|'codex'} [harness] */
async function guardBox(t, harness = "claude") {
  const box = await sandbox(t, { git: false });
  const home = harness === "claude" ? ".claude" : ".codex";
  await box.write(
    `${home}/registry/installation.json`,
    JSON.stringify(
      harness === "claude"
        ? {
            harness,
            registration: "settings.json",
            overrides: ["settings.local.json"],
          }
        : { harness, registration: "hooks.json", configuration: "config.toml" },
    ),
  );
  await box.write(`${home}/hooks/vouch-guard-writes.mjs`, "// entry\n");
  await box.write(
    `${home}/${harness === "claude" ? "settings" : "hooks"}.json`,
    "{}\n",
  );
  await box.write(`vouch/intents/${intent}/audit/events.jsonl`, record);
  await box.write(`vouch/intents/${intent}/intent.md`, draft);
  await box.write("vouch/intents/260929-done/intent.md", approvedText);
  const files = await createFileStore(box.root);
  /** @type {import('../../../core/hooks/lib/contracts.mjs').ReadyHookContext} */
  const ctx = {
    projectRoot: box.root,
    harness,
    generation: "test",
    ...fakeClock(),
    readText: files.readText,
    locate: files.locate,
  };
  const entry = box.path(`${home}/hooks/vouch-guard-writes.mjs`);
  /** @param {string} tool @param {Record<string,unknown>} input @param {string} [cwd] */
  async function decide(tool, input, cwd = box.root) {
    const result = await guardWrites(
      {
        session_id: "s",
        cwd,
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input: input,
      },
      ctx,
      entry,
    );
    return result.decision === "deny"
      ? /** @type {string} */ (result.reason.split(":")[0])
      : "allow";
  }
  return { ...box, ctx, entry, decide };
}

const audit = `vouch/intents/${intent}/audit/events.jsonl`;

test("managed user runtime is protected outside the project and manual operations remain callable", async (t) => {
  const box = await sandbox(t, { git: false });
  await mkdir(box.path("project"));
  const files = await createFileStore(box.path("project"));
  const runtime = box.path("home/.vouch/versions/hash/cursor/hooks");
  const ctx = {
    projectRoot: box.path("project"),
    harness: /** @type {const} */ ("cursor"),
    generation: "test",
    ...fakeClock(),
    readText: files.readText,
    locate: files.locate,
  };
  /** @param {string} tool @param {Record<string,unknown>} tool_input */
  const decide = (tool, tool_input) =>
    guardWrites(
      {
        session_id: "s",
        cwd: ctx.projectRoot,
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input,
      },
      ctx,
      `${runtime}/vouch-guard-writes.mjs`,
    );
  t.assert.equal(
    (
      await decide("Write", {
        file_path: `${runtime}/lib/env.mjs`,
        content: "tamper",
      })
    ).decision,
    "deny",
  );
  t.assert.equal(
    (
      await decide("Write", {
        file_path: box.path("outside/unrelated.mjs"),
        content: "code",
      })
    ).decision,
    "allow",
  );
  for (const action of [
    "doctor",
    "dod",
    "lifecycle",
    "question",
    "migrate",
    "report",
  ])
    t.assert.equal(
      (
        await decide("Bash", {
          command: `node '${runtime}/vouch-launch.mjs' ${action} manual`,
        })
      ).decision,
      "allow",
      action,
    );
  t.assert.equal(
    (
      await decide("Bash", {
        command: `node '${runtime}/vouch-launch.mjs' session user`,
      })
    ).decision,
    "deny",
  );
});
const artifact = `vouch/intents/${intent}/intent.md`;
const done = "vouch/intents/260929-done/intent.md";

test("managed runtime aliases protect existing and missing targets across file, patch and shell tools", async (t) => {
  const box = await sandbox(t, { git: false });
  const root = box.path("project");
  const runtime = box.path("home/.vouch/versions/hash/cursor");
  await box.write(
    "home/.vouch/versions/hash/cursor/hooks/lib/env.mjs",
    "trusted",
  );
  await box.write(
    "home/.vouch/versions/hash/cursor/registry/installation.json",
    "{}",
  );
  await box.write("home/other/file.mjs", "unrelated");
  await mkdir(box.path("project/links"), { recursive: true });
  await symlink(runtime, box.path("project/links/selected"), "junction");
  await symlink(box.path("home"), box.path("project/links/home"), "junction");
  await symlink(
    box.path("home/other"),
    box.path("project/links/unrelated"),
    "junction",
  );
  const files = await createFileStore(root);
  const ctx = {
    projectRoot: root,
    harness: /** @type {const} */ ("cursor"),
    generation: "test",
    ...fakeClock(),
    readText: files.readText,
    locate: files.locate,
  };
  /** @param {string} tool_name @param {Record<string,unknown>} tool_input */
  const decide = (tool_name, tool_input) =>
    guardWrites(
      {
        session_id: "s",
        cwd: root,
        hook_event_name: "PreToolUse",
        tool_name,
        tool_input,
      },
      ctx,
      `${runtime}/hooks/vouch-guard-writes.mjs`,
    );
  for (const [
    tool,
    input,
  ] of /** @type {[string,Record<string,unknown>][]} */ ([
    [
      "Write",
      { file_path: "links/selected/hooks/lib/env.mjs", content: "tamper" },
    ],
    [
      "Edit",
      {
        file_path: "links/selected/registry/installation.json",
        old_string: "{}",
        new_string: "tamper",
      },
    ],
    ["Write", { file_path: "links/selected/hooks/new.mjs", content: "tamper" }],
    ["Delete", { file_path: "links/selected/hooks/lib/env.mjs" }],
    ["Delete", { file_path: "links/home" }],
    [
      "apply_patch",
      {
        command:
          "*** Begin Patch\n*** Update File: links/selected/hooks/lib/env.mjs\n+tamper\n*** End Patch",
      },
    ],
    ["Bash", { command: "echo tamper > links/selected/hooks/lib/env.mjs" }],
    ["Bash", { command: "rm -rf links/home" }],
  ])) {
    const result = await decide(tool, input);
    t.assert.equal(result.decision, "deny", tool);
    t.assert.match(
      result.decision === "deny" ? result.reason : "",
      /VOUCH-GUARD-INSTALLATION/,
    );
  }
  for (const [
    tool,
    input,
  ] of /** @type {[string,Record<string,unknown>][]} */ ([
    [
      "Write",
      { file_path: "links/unrelated/file.mjs", content: "application" },
    ],
    ["Bash", { command: "cat links/selected/hooks/lib/env.mjs" }],
  ]))
    t.assert.equal((await decide(tool, input)).decision, "allow", tool);
  t.assert.equal(
    await box.read("home/.vouch/versions/hash/cursor/hooks/lib/env.mjs"),
    "trusted",
  );
});

test("guardWrites refuses Claude file writes to the audit, locks and installation whatever the content", async (t) => {
  const box = await guardBox(t);
  const forged = `${JSON.stringify({ id: "evt_y", v: 1, type: "session.started", ts: "2026-09-29T00:00:01.000Z", actor: "hook", session: "s" })}\n`;
  /** @type {[string,Record<string,unknown>,string][]} */
  const cases = [
    [
      "Write",
      { file_path: box.path(audit), content: record + forged, actor: "hook" },
      "VOUCH-GUARD-AUDIT",
    ],
    [
      "Edit",
      { file_path: box.path(audit), old_string: "s", new_string: "t" },
      "VOUCH-GUARD-AUDIT",
    ],
    [
      "Write",
      {
        file_path: box.path(`vouch/intents/new/audit/events.jsonl`),
        content: forged,
      },
      "VOUCH-GUARD-AUDIT",
    ],
    [
      "Write",
      {
        file_path: box.path("VOUCH/Intents/x/AUDIT/events.jsonl."),
        content: forged,
      },
      "VOUCH-GUARD-AUDIT",
    ],
    [
      "Write",
      { file_path: box.path(`${audit}:stream`), content: forged },
      "VOUCH-GUARD-AUDIT",
    ],
    [
      "Write",
      { file_path: box.path(`${audit}.vouch-lock/next`), content: forged },
      "VOUCH-GUARD-AUDIT",
    ],
    [
      "Write",
      { file_path: box.path(`${artifact}.vouch-lock/next`), content: draft },
      "VOUCH-GUARD-LOCK",
    ],
    [
      "Write",
      { file_path: box.path(".claude/settings.json"), content: "{}" },
      "VOUCH-GUARD-INSTALLATION",
    ],
    [
      "Write",
      {
        file_path: box.path(".claude/settings.local.json"),
        content: '{"disableAllHooks":true}',
      },
      "VOUCH-GUARD-INSTALLATION",
    ],
    [
      "Edit",
      {
        file_path: box.path(".claude/hooks/vouch-guard-writes.mjs"),
        old_string: "entry",
        new_string: "off",
      },
      "VOUCH-GUARD-INSTALLATION",
    ],
    [
      "Write",
      {
        file_path: box.path(".claude/registry/audit-event.schema.json"),
        content: "{}",
      },
      "VOUCH-GUARD-INSTALLATION",
    ],
    [
      "Write",
      { file_path: box.path(".claude/commands/x.md"), content: "free" },
      "allow",
    ],
    ["Write", { file_path: box.path("src/app.js"), content: "free" }, "allow"],
    [
      "Write",
      { file_path: box.path("../outside.txt"), content: "free" },
      "allow",
    ],
    [
      "Write",
      {
        file_path: `${box.root}/../${box.root.split(/[\\/]/).at(-1)}/${audit}`,
        content: forged,
      },
      "VOUCH-GUARD-AUDIT",
    ],
  ];
  t.plan(cases.length + 1);
  for (const [tool, input, expected] of cases)
    t.assert.equal(
      await box.decide(tool, input),
      expected,
      `${tool} ${input.file_path}`,
    );
  t.assert.equal(await box.read(audit), record, "the guard never writes");
});

test("guardWrites follows links and root aliases and refuses unresolvable or hard-linked targets", async (t) => {
  const box = await guardBox(t);
  const other = await sandbox(t, { git: false });
  await symlink(box.path(audit), box.path("alias.jsonl"));
  await symlink(
    box.path(`vouch/intents/${intent}/audit`),
    box.path("audit-dir"),
    "junction",
  );
  await symlink(box.root, other.path("root-alias"), "junction");
  await symlink(box.path(audit), other.path("outside-link"));
  await symlink(box.path("missing/target"), box.path("dangling"));
  await symlink(box.path("loop-b"), box.path("loop-a"));
  await symlink(box.path("loop-a"), box.path("loop-b"));
  await box.write("original.txt", "x");
  await link(box.path("original.txt"), box.path("hardlink.txt"));
  await mkdir(box.path("src"));
  await symlink(box.path("src"), box.path("src-link"), "junction");
  /** @type {[string,string][]} */
  const cases = [
    [box.path("alias.jsonl"), "VOUCH-GUARD-AUDIT"],
    [box.path("audit-dir/events.jsonl"), "VOUCH-GUARD-AUDIT"],
    [other.path(`root-alias/${audit}`), "VOUCH-GUARD-AUDIT"],
    [other.path("outside-link"), "VOUCH-GUARD-AUDIT"],
    [box.path("dangling"), "VOUCH-GUARD-LINK"],
    [box.path("loop-a"), "VOUCH-GUARD-LINK"],
    [box.path("hardlink.txt"), "VOUCH-GUARD-LINK"],
    [box.path("src-link/file.js"), "allow"],
  ];
  t.plan(cases.length);
  for (const [file_path, expected] of cases)
    t.assert.equal(
      await box.decide("Write", { file_path, content: "x" }),
      expected,
      file_path,
    );
});

test("guardWrites permits draft edits and refuses writes that change or create an approved artifact", async (t) => {
  const box = await guardBox(t);
  await box.write("vouch/intents/260929-bytes/decisions.md", "");
  await writeFile(
    box.path("vouch/intents/260929-bytes/intent.md"),
    Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe]),
  );
  /** @type {[string,Record<string,unknown>,string][]} */
  const cases = [
    [
      "Write",
      { file_path: box.path(artifact), content: `${draft}more\n` },
      "allow",
    ],
    [
      "Write",
      { file_path: box.path(artifact), content: approvedText },
      "VOUCH-GUARD-APPROVED",
    ],
    [
      "Write",
      { file_path: box.path(done), content: draft },
      "VOUCH-GUARD-APPROVED",
    ],
    [
      "Write",
      {
        file_path: box.path("vouch/intents/260929-new/design.md"),
        content: approvedText,
      },
      "VOUCH-GUARD-APPROVED",
    ],
    [
      "Write",
      {
        file_path: box.path("vouch/intents/260929-new/design.md"),
        content: draft,
      },
      "allow",
    ],
    [
      "Edit",
      {
        file_path: box.path(artifact),
        old_string: "AC-1: keep it.",
        new_string: "AC-1: keep it well.",
      },
      "allow",
    ],
    [
      "Edit",
      {
        file_path: box.path(artifact),
        old_string: "status: draft",
        new_string: "status: approved",
      },
      "VOUCH-GUARD-APPROVED",
    ],
    [
      "Edit",
      {
        file_path: box.path(artifact),
        old_string: "draft",
        new_string: "approved",
        replace_all: true,
      },
      "VOUCH-GUARD-APPROVED",
    ],
    [
      "Edit",
      {
        file_path: box.path(artifact),
        old_string: "absent",
        new_string: "status: approved",
      },
      "VOUCH-GUARD-APPROVED",
    ],
    [
      "Edit",
      {
        file_path: box.path(artifact),
        old_string: "absent",
        new_string: "fine",
      },
      "allow",
    ],
    [
      "Edit",
      {
        file_path: box.path("vouch/intents/260929-new/intent.md"),
        old_string: "",
        new_string: approvedText,
      },
      "VOUCH-GUARD-APPROVED",
    ],
    [
      "Edit",
      { file_path: box.path(done), old_string: "AC-1", new_string: "AC-2" },
      "VOUCH-GUARD-APPROVED",
    ],
    [
      "Write",
      {
        file_path: box.path("vouch/intents/260929-bytes/intent.md"),
        content: draft,
      },
      "VOUCH-GUARD-UNVERIFIED",
    ],
    [
      "Write",
      {
        file_path: box.path("vouch/intents/260929-guard/decisions.md"),
        content: approvedText,
      },
      "allow",
    ],
  ];
  t.plan(cases.length + 1);
  for (const [tool, input, expected] of cases)
    t.assert.equal(
      await box.decide(tool, input),
      expected,
      `${tool} ${JSON.stringify(input).slice(0, 120)}`,
    );
  t.assert.equal(await box.read(artifact), draft);
});

test("guardWrites inspects every Codex patch operation, move source and destination", async (t) => {
  const box = await guardBox(t, "codex");
  /** @param {string[]} lines */
  const patch = (...lines) =>
    ["*** Begin Patch", ...lines, "*** End Patch", ""].join("\n");
  /** @type {[string,string][]} */
  const cases = [
    [patch(`*** Add File: ${audit}`, "+{}"), "VOUCH-GUARD-AUDIT"],
    [patch(`*** Delete File: ${audit}`), "VOUCH-GUARD-AUDIT"],
    [
      patch("*** Update File: notes.md", `*** Move to: ${audit}`, "+x"),
      "VOUCH-GUARD-AUDIT",
    ],
    [
      patch("*** Update File: .codex/hooks.json", "-{}", '+{"hooks":{}}'),
      "VOUCH-GUARD-INSTALLATION",
    ],
    [
      patch(
        "*** Add File: .codex/config.toml",
        "+[features]",
        "+hooks = false",
      ),
      "VOUCH-GUARD-INSTALLATION",
    ],
    [
      patch(
        `*** Update File: ${artifact}`,
        "@@",
        "-status: draft",
        "+status: approved",
      ),
      "VOUCH-GUARD-APPROVED",
    ],
    [
      patch(`*** Update File: ${done}`, "@@", "-AC-1", "+AC-2"),
      "VOUCH-GUARD-APPROVED",
    ],
    [patch(`*** Delete File: ${done}`), "VOUCH-GUARD-APPROVED"],
    [
      patch(
        "*** Add File: vouch/intents/260929-new/intent.md",
        "+---",
        "+status: approved",
        "+---",
      ),
      "VOUCH-GUARD-APPROVED",
    ],
    [
      patch(`*** Update File: ${artifact}`, `*** Move to: ${done}`, "+x"),
      "VOUCH-GUARD-APPROVED",
    ],
    [
      patch(
        `*** Update File: ${artifact}`,
        "@@",
        "-AC-1: keep it.",
        "+AC-1: keep it well.",
      ),
      "allow",
    ],
    [
      patch(
        "*** Add File: vouch/intents/260929-new/intent.md",
        "+---",
        "+status: draft",
        "+---",
      ),
      "allow",
    ],
    [
      patch(
        `*** Update File: ${artifact}`,
        "*** Move to: vouch/intents/260929-moved/intent.md",
        "+x",
      ),
      "allow",
    ],
    [patch("*** Add File: src/app.js", "+status: approved"), "allow"],
    ["not a patch", "allow"],
  ];
  t.plan(cases.length);
  for (const [command, expected] of cases)
    t.assert.equal(
      await box.decide("apply_patch", { command }),
      expected,
      command,
    );
});

test("guardWrites lets recognized reads name protected files and refuses shell writes that name them", async (t) => {
  const box = await guardBox(t);
  await symlink(box.path(audit), box.path("alias.jsonl"));
  /** @type {[string,string][]} */
  const cases = [
    [`cat ${audit}`, "allow"],
    [`sed -n '1,20p' ${audit} | jq .`, "allow"],
    [`git add ${audit} ${artifact} && git commit -m record`, "allow"],
    ["cat .claude/settings.json", "allow"],
    ["node .claude/hooks/vouch-doctor.mjs", "allow"],
    ['node ".claude/hooks/vouch-doctor.mjs"', "allow"],
    ["node .claude/hooks/vouch-question.mjs ask Q-1", "allow"],
    ["node .claude/hooks/vouch-report.mjs", "allow"],
    [
      "node .claude/hooks/vouch-question.mjs ask Q-1 > .claude/hooks/x",
      "VOUCH-GUARD-INSTALLATION",
    ],
    [
      "node .claude/hooks/vouch-record-session-start.mjs startup",
      "VOUCH-GUARD-INSTALLATION",
    ],
    ["git add . && npm test", "allow"],
    ["ls vouch/intents && mkdir -p vouch/intents/260929-new", "allow"],
    [`touch vouch/intents/${intent}/notes.md && rm -f notes.txt`, "allow"],
    [`echo '{"actor":"hook"}' >> ${audit}`, "VOUCH-GUARD-AUDIT"],
    [`sed -i 's/s/t/' ${audit}`, "VOUCH-GUARD-AUDIT"],
    [
      `cd vouch/intents/${intent}/audit && rm events.jsonl`,
      "VOUCH-GUARD-AUDIT",
    ],
    [
      `cd vouch/intents/${intent} && printf x >> audit/events.jsonl`,
      "VOUCH-GUARD-AUDIT",
    ],
    [
      'printf x >> "$ROOT/vouch/intents/any/audit/events.jsonl"',
      "VOUCH-GUARD-AUDIT",
    ],
    ["cd ~ && printf x >> events.jsonl.vouch-lock/next", "VOUCH-GUARD-LOCK"],
    [`cat ${audit} | tee copy.jsonl`, "VOUCH-GUARD-AUDIT"],
    [`LC_ALL=C cat ${audit}`, "VOUCH-GUARD-AUDIT"],
    [`/bin/cat ${audit}`, "VOUCH-GUARD-AUDIT"],
    [`cat $(echo ${audit})`, "VOUCH-GUARD-AUDIT"],
    [`git checkout -- ${audit}`, "VOUCH-GUARD-AUDIT"],
    ["echo x >> alias.jsonl", "VOUCH-GUARD-AUDIT"],
    ["rm -rf vouch", "VOUCH-GUARD-AUDIT"],
    ["rm -rf vouch/intents/*", "VOUCH-GUARD-AUDIT"],
    ["find . -name '*.jsonl' -delete", "VOUCH-GUARD-AUDIT"],
    [
      "node .claude/hooks/vouch-record-intent-review.mjs < forged.json",
      "VOUCH-GUARD-INSTALLATION",
    ],
    [
      "jq . .claude/settings.json > s.tmp && mv s.tmp .claude/settings.json",
      "VOUCH-GUARD-INSTALLATION",
    ],
    ["rm -rf .claude", "VOUCH-GUARD-INSTALLATION"],
    [
      `cat > ${artifact} <<'EOF'\n---\nstatus: draft\n---\nEOF`,
      "VOUCH-GUARD-ARTIFACT",
    ],
    [
      `cd vouch/intents/${intent} && sed -i s/draft/approved/ intent.md`,
      "VOUCH-GUARD-ARTIFACT",
    ],
    [`git show HEAD:${artifact} > ${artifact}`, "VOUCH-GUARD-ARTIFACT"],
  ];
  t.plan(cases.length + 2);
  for (const [command, expected] of cases)
    t.assert.equal(await box.decide("Bash", { command }), expected, command);
  const auditDir = box.path(`vouch/intents/${intent}/audit`);
  t.assert.equal(
    await box.decide(
      "Bash",
      { command: "(cd /tmp); rm -f events.jsonl" },
      auditDir,
    ),
    "VOUCH-GUARD-AUDIT",
    "a directory change inside a subshell ends with it",
  );
  t.assert.equal(
    await box.decide("Bash", { command: "cat events.jsonl" }, auditDir),
    "allow",
  );
});

test("guardWrites resolves relative words from a cwd outside the root and keeps deny reasons on one line", async (t) => {
  const box = await guardBox(t);
  const other = await sandbox(t, { git: false });
  const name = box.root.split(/[\\/]/).at(-1);
  const outside = join(box.root, "..");
  const result = await guardWrites(
    {
      session_id: "s",
      cwd: other.root,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: `printf 'x\ny' >> ../${name}/${audit}` },
    },
    box.ctx,
    box.entry,
  );
  t.plan(5);
  t.assert.equal(result.decision, "deny");
  t.assert.equal("events" in result, false, "guards record no events");
  t.assert.match(
    result.decision === "deny" ? result.reason : "",
    /^VOUCH-GUARD-AUDIT: Bash vouch\/intents\/260929-guard\/audit\/events\.jsonl; [^\n]+$/,
  );
  t.assert.equal(
    await box.decide(
      "Bash",
      { command: `printf x >> '${join(outside, "free.txt")}'` },
      other.root,
    ),
    "allow",
  );
  t.assert.equal(
    await box.decide(
      "Write",
      { file_path: `../${name}/${artifact}`, content: approvedText },
      other.root,
    ),
    "VOUCH-GUARD-APPROVED",
  );
});

test("guardWrites allows other events, unregistered tools and inputs the tool itself cannot run", async (t) => {
  const box = await guardBox(t);
  /** @type {import('../../../core/hooks/lib/contracts.mjs').HookInput[]} */
  const inputs = [
    {
      session_id: "s",
      cwd: box.root,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: box.path(audit) },
      tool_response: {},
    },
    {
      session_id: "s",
      cwd: box.root,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: box.path(audit) },
    },
    {
      session_id: "s",
      cwd: box.root,
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { command: `*** Add File: ${audit}` },
    },
    {
      session_id: "s",
      cwd: box.root,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { content: "no path" },
    },
    {
      session_id: "s",
      cwd: box.root,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: 7 },
    },
    {
      session_id: "s",
      cwd: box.root,
      hook_event_name: "UserPromptSubmit",
      prompt: `echo x >> ${audit}`,
    },
  ];
  t.plan(inputs.length);
  for (const input of inputs)
    t.assert.deepEqual(await guardWrites(input, box.ctx, box.entry), {
      decision: "allow",
    });
});

test("guardWrites protects the whole installation when its descriptor cannot be read and none outside the root", async (t) => {
  const box = await guardBox(t);
  await box.write(".claude/registry/installation.json", "not json");
  const outside = await sandbox(t, { git: false });
  t.plan(3);
  t.assert.equal(
    await box.decide("Write", {
      file_path: box.path(".claude/anything.json"),
      content: "{}",
    }),
    "VOUCH-GUARD-INSTALLATION",
  );
  const detached = await guardWrites(
    {
      session_id: "s",
      cwd: box.root,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: {
        file_path: box.path(".claude/settings.json"),
        content: "{}",
      },
    },
    box.ctx,
    outside.path("core/hooks/vouch-guard-writes.mjs"),
  );
  t.assert.deepEqual(detached, { decision: "allow" });
  t.assert.equal(
    await box.decide("Write", { file_path: box.path(audit), content: "" }),
    "VOUCH-GUARD-AUDIT",
  );
});

test("guardWrites accepts its entry as a file URL and protects the installation without a descriptor", async (t) => {
  const box = await guardBox(t);
  await unlink(box.path(".claude/registry/installation.json"));
  const result = await guardWrites(
    {
      session_id: "s",
      cwd: box.root,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: box.path(".claude/other.json"), content: "{}" },
    },
    box.ctx,
    pathToFileURL(box.entry).href,
  );
  t.plan(1);
  t.assert.match(
    result.decision === "deny" ? result.reason : "",
    /^VOUCH-GUARD-INSTALLATION: Write \.claude\/other\.json; /,
  );
});

test("guardWrites keeps approved artifacts protected when an edit lacks its replacement", async (t) => {
  const box = await guardBox(t);
  t.plan(2);
  t.assert.equal(
    await box.decide("Edit", {
      file_path: box.path(artifact),
      old_string: "AC-1",
    }),
    "allow",
  );
  t.assert.equal(
    await box.decide("Edit", { file_path: box.path(done), old_string: "AC-1" }),
    "VOUCH-GUARD-APPROVED",
  );
});

test("guardWrites re-anchors shell words at absolute directory changes and refuses unverifiable links", async (t) => {
  const box = await guardBox(t);
  const other = await sandbox(t, { git: false });
  await other.write("hooks/vouch-doctor.mjs", "");
  await symlink(box.path("missing/target"), box.path("dangling"));
  await box.write("shared.txt", "x");
  await link(box.path("shared.txt"), box.path("hard.txt"));
  const auditDir = box.path(`vouch/intents/${intent}/audit`);
  /** @type {[string,string,string?][]} */
  const cases = [
    [`cd ~ && cd '${auditDir}' && rm events.jsonl`, "VOUCH-GUARD-AUDIT"],
    [`cd ~ && cd sub && echo x > ${audit}`, "VOUCH-GUARD-AUDIT"],
    ["rm -f events.jsonl events.jsonl", "VOUCH-GUARD-AUDIT", auditDir],
    [
      `node '${other.path("hooks/vouch-doctor.mjs")}'; cat ${audit}`,
      "VOUCH-GUARD-AUDIT",
    ],
    ["echo x > dangling", "VOUCH-GUARD-LINK"],
    ["echo x >> hard.txt", "VOUCH-GUARD-LINK"],
    ["cat hard.txt dangling", "allow"],
  ];
  t.plan(cases.length);
  for (const [command, expected, cwd] of cases)
    t.assert.equal(
      await box.decide("Bash", { command }, cwd),
      expected,
      command,
    );
});

test("guardWrites finds protected paths spelled with backslashes, as PowerShell and Windows paths are", async (t) => {
  const box = await guardBox(t);
  const windows = (/** @type {string} */ path) => path.replaceAll("/", "\\");
  /** @type {[string,string][]} */
  const cases = [
    [
      `Add-Content -Path ${windows(box.path(audit))} -Value x`,
      "VOUCH-GUARD-AUDIT",
    ],
    [`Set-Content ${windows(audit)} x`, "VOUCH-GUARD-AUDIT"],
    ["Remove-Item -Recurse .claude\\hooks", "VOUCH-GUARD-INSTALLATION"],
    // PowerShell reads are not recognized as read-only, so they are refused too.
    [`Get-Content ${windows(audit)}`, "VOUCH-GUARD-AUDIT"],
    [`Set-Content ${windows(`vouch/intents/${intent}/notes.md`)} x`, "allow"],
  ];
  t.plan(cases.length);
  for (const [command, expected] of cases)
    t.assert.equal(await box.decide("Bash", { command }), expected, command);
});

test("guardWrites treats a malformed installation descriptor as unreadable", async (t) => {
  const box = await guardBox(t);
  await box.write(
    ".claude/registry/installation.json",
    JSON.stringify({
      harness: "claude",
      registration: "settings.json",
      overrides: "settings.local.json",
    }),
  );
  t.plan(2);
  t.assert.equal(
    await box.decide("Write", {
      file_path: box.path(".claude/settings.local.json"),
      content: "{}",
    }),
    "VOUCH-GUARD-INSTALLATION",
  );
  t.assert.equal(
    await box.decide("Write", {
      file_path: box.path(".claude/other.json"),
      content: "{}",
    }),
    "VOUCH-GUARD-INSTALLATION",
  );
});

test("guardWrites states each documented reason in one line", async (t) => {
  const box = await guardBox(t);
  await symlink(box.path("missing/target"), box.path("dangling"));
  await box.write("vouch/intents/260929-bytes/decisions.md", "");
  await writeFile(
    box.path("vouch/intents/260929-bytes/intent.md"),
    Buffer.from([0xff]),
  );
  /** @param {string} tool @param {Record<string,unknown>} input */
  const reason = async (tool, input) => {
    const result = await guardWrites(
      {
        session_id: "s",
        cwd: box.root,
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input: input,
      },
      box.ctx,
      box.entry,
    );
    return result.decision === "deny" ? result.reason : "allow";
  };
  const newline = box.path(`vouch/intents/${intent}/audit/x\ny`);
  t.plan(9);
  t.assert.equal(
    await reason("Write", { file_path: box.path(audit), content: "" }),
    `VOUCH-GUARD-AUDIT: Write ${audit}; audit records are appended only by Vouch hooks`,
  );
  t.assert.equal(
    await reason("Write", {
      file_path: box.path("a.vouch-lock/next"),
      content: "",
    }),
    "VOUCH-GUARD-LOCK: Write a.vouch-lock/next; a Vouch hook owns this lock and its pending file",
  );
  t.assert.equal(
    await reason("Write", {
      file_path: box.path(".claude/settings.json"),
      content: "",
    }),
    "VOUCH-GUARD-INSTALLATION: Write .claude/settings.json; the installed hook registration and runtime change only by reinstalling the distribution",
  );
  t.assert.equal(
    await reason("Write", { file_path: box.path(done), content: "" }),
    `VOUCH-GUARD-APPROVED: Write ${done}; tools neither change nor create approved artifacts`,
  );
  t.assert.equal(
    await reason("Bash", { command: `echo x > ${artifact}` }),
    `VOUCH-GUARD-ARTIFACT: Bash ${artifact}; shell writes to Vouch artifacts cannot be verified; use the file edit tool`,
  );
  t.assert.equal(
    await reason("Write", { file_path: box.path("dangling"), content: "" }),
    "VOUCH-GUARD-LINK: Write dangling; the real target of this link cannot be verified",
  );
  t.assert.equal(
    await reason("Write", {
      file_path: box.path("vouch/intents/260929-bytes/intent.md"),
      content: "",
    }),
    "VOUCH-GUARD-UNVERIFIED: Write vouch/intents/260929-bytes/intent.md; the current artifact could not be read to verify its status",
  );
  t.assert.equal(
    await reason("Write", { file_path: newline, content: "" }),
    `VOUCH-GUARD-AUDIT: Write vouch/intents/${intent}/audit/x?y; audit records are appended only by Vouch hooks`,
  );
  t.assert.equal(
    await reason("Bash", { command: `touch ${"{a,b}".repeat(9)}` }),
    `VOUCH-GUARD-UNVERIFIED: Bash ${"{a,b}".repeat(9)}; the brace expansion has too many results to verify`,
  );
});

test("guardWrites reads edits, writes and moves the way the tools apply them", async (t) => {
  const box = await guardBox(t);
  const titled = "vouch/intents/260929-titled/intent.md";
  await box.write(titled, "---\ntitle: draft notes\nstatus: draft\n---\n");
  await box.write("vouch/intents/260929-dir/design.md/keep", "");
  /** @type {[string,Record<string,unknown>,string][]} */
  const cases = [
    [
      "Edit",
      {
        file_path: box.path(titled),
        old_string: "draft",
        new_string: "approved",
      },
      "allow",
    ],
    [
      "Edit",
      {
        file_path: box.path(titled),
        old_string: "draft",
        new_string: "approved",
        replace_all: true,
      },
      "VOUCH-GUARD-APPROVED",
    ],
    ["Edit", { file_path: box.path(artifact), old_string: "absent" }, "allow"],
    [
      "Edit",
      {
        file_path: box.path(artifact),
        old_string: 1,
        new_string: "status: approved",
      },
      "VOUCH-GUARD-APPROVED",
    ],
    [
      "Edit",
      {
        file_path: box.path(artifact),
        old_string: "",
        new_string: "status: approved",
      },
      "VOUCH-GUARD-APPROVED",
    ],
    [
      "Edit",
      {
        file_path: box.path("vouch/intents/260929-new/intent.md"),
        old_string: "x",
        new_string: "y",
      },
      "allow",
    ],
    ["Write", { file_path: box.path(artifact), content: 42 }, "allow"],
    [
      "Write",
      {
        file_path: box.path("vouch/intents/260929-dir/design.md"),
        content: draft,
      },
      "allow",
    ],
  ];
  t.plan(cases.length + 1);
  for (const [tool, input, expected] of cases)
    t.assert.equal(
      await box.decide(tool, input),
      expected,
      JSON.stringify(input),
    );
  const codex = await guardBox(t, "codex");
  t.assert.equal(
    await codex.decide("apply_patch", {
      command:
        "*** Begin Patch\n*** Update File: notes.md\n*** Move to: vouch/intents/260929-new/intent.md\n+status: approved\n*** End Patch\n",
    }),
    "VOUCH-GUARD-APPROVED",
  );
});

test("guardWrites follows directory changes, subshells and unknown bases in shell commands", async (t) => {
  const box = await guardBox(t);
  const dir = `vouch/intents/${intent}`;
  /** @type {[string,string][]} */
  const cases = [
    [`cd ${dir} && rm -r audit`, "VOUCH-GUARD-AUDIT"],
    [`cd ${dir} && (cd /tmp) && rm -r audit`, "VOUCH-GUARD-AUDIT"],
    [`pushd ${dir} && rm -r audit`, "VOUCH-GUARD-AUDIT"],
    // After popd or cd - the base is unknown; only whole spellings are recognized then.
    [`cd ${dir} && popd && rm -r audit`, "allow"],
    [`cd ${dir} && cd - && rm -r audit`, "allow"],
    ["cd ~ && node .claude/hooks/vouch-doctor.mjs", "VOUCH-GUARD-INSTALLATION"],
    [
      "node .claude/hooks/vouch-record-intent-review.mjs",
      "VOUCH-GUARD-INSTALLATION",
    ],
    ["echo -exec .", "allow"],
    ["rm -rf ..", "VOUCH-GUARD-AUDIT"],
    ["mkdir -p ..", "allow"],
  ];
  t.plan(cases.length);
  for (const [command, expected] of cases)
    t.assert.equal(await box.decide("Bash", { command }), expected, command);
});

test("guardWrites recognizes protected spellings behind variables and orders reasons by priority", async (t) => {
  const box = await guardBox(t);
  const other = await sandbox(t, { git: false });
  await box.write("existing.txt", "x");
  await other.write("free.txt", "x");
  /** @type {[string,string][]} */
  const cases = [
    ['echo x > "$ROOT/.claude/settings.json"', "VOUCH-GUARD-INSTALLATION"],
    ['echo x > "$ROOT/vouch/intents/x/intent.md"', "VOUCH-GUARD-ARTIFACT"],
    ['printf x >> "$DIR/audit/events.jsonl"', "VOUCH-GUARD-AUDIT"],
    [
      "Add-Content $env:ROOT\\vouch\\intents\\x\\audit\\events.jsonl x",
      "VOUCH-GUARD-AUDIT",
    ],
    [`rm ${artifact} ${audit}`, "VOUCH-GUARD-AUDIT"],
    ["rm -f existing.txt", "allow"],
    [`rm -f '${other.path("free.txt")}'`, "allow"],
  ];
  t.plan(cases.length);
  for (const [command, expected] of cases)
    t.assert.equal(await box.decide("Bash", { command }), expected, command);
});

test("guardWrites refuses the whole installation when a descriptor lists non-string overrides", async (t) => {
  const box = await guardBox(t);
  await box.write(
    ".claude/registry/installation.json",
    JSON.stringify({
      harness: "claude",
      registration: "settings.json",
      overrides: [1],
    }),
  );
  t.plan(1);
  t.assert.equal(
    await box.decide("Write", {
      file_path: box.path(".claude/other.json"),
      content: "{}",
    }),
    "VOUCH-GUARD-INSTALLATION",
  );
});

test("guardWrites expands braces like bash before classifying shell words", async (t) => {
  const box = await guardBox(t);
  const home = `vouch/intents/${intent}`;
  /** @type {[string,string,string?][]} */
  const cases = [
    [`echo x >> ${home}/{audit,b}/events.jsonl`, "VOUCH-GUARD-AUDIT"],
    [`echo x >> ${home}/au{d,}it/events.jsonl`, "VOUCH-GUARD-AUDIT"],
    [`echo x >> ${home}/aud{h..j}t/events.jsonl`, "VOUCH-GUARD-AUDIT"],
    [`rm -rf ${home}/{audit,tmp}`, "VOUCH-GUARD-AUDIT"],
    ["echo x >> {notes,audit}/next.jsonl", "VOUCH-GUARD-AUDIT", box.path(home)],
    ["cp x .claude/{hooks,y}/z", "VOUCH-GUARD-INSTALLATION"],
    [`echo x > ${home}/{intent,design}.md`, "VOUCH-GUARD-ARTIFACT"],
    [`touch ${"{a,b}".repeat(9)}`, "VOUCH-GUARD-UNVERIFIED"],
    [`ls ${"{a,b}".repeat(9)}`, "allow"],
    [`cat ${home}/{audit/events.jsonl,intent.md}`, "allow"],
    ["for i in {1..1000}; do echo $i >> out.txt; done", "allow"],
    ["cp notes.{md,bak} && echo x >> {notes,log}/next.jsonl", "allow"],
  ];
  t.plan(cases.length);
  for (const [command, expected, cwd] of cases)
    t.assert.equal(
      await box.decide("Bash", { command }, cwd),
      expected,
      command,
    );
});

test("guardWrites keeps deciding when a word cannot be looked up", async (t) => {
  const box = await guardBox(t);
  await symlink(box.path("loop-b"), box.path("loop-a"));
  await symlink(box.path("loop-a"), box.path("loop-b"));
  const long = "a".repeat(300);
  /** @type {[string,Record<string,unknown>,string][]} */
  const cases = [
    [
      "Bash",
      { command: `echo x >> ${audit}; cat loop-a/x` },
      "VOUCH-GUARD-AUDIT",
    ],
    [
      "Bash",
      { command: `echo x >> ${audit}; cat ${long}` },
      "VOUCH-GUARD-AUDIT",
    ],
    ["Bash", { command: `cat ${long}/x ${audit}` }, "allow"],
    ["Bash", { command: "echo x > loop-a/x" }, "VOUCH-GUARD-LINK"],
    [
      "Write",
      { file_path: box.path("loop-a/x"), content: "" },
      "VOUCH-GUARD-LINK",
    ],
    ["Write", { file_path: box.path(long), content: "" }, "allow"],
    [
      "Write",
      {
        file_path: box.path(`vouch/intents/${intent}/audit/${long}`),
        content: "",
      },
      "VOUCH-GUARD-AUDIT",
    ],
  ];
  t.plan(cases.length);
  for (const [tool, input, expected] of cases)
    t.assert.equal(
      await box.decide(tool, input),
      expected,
      JSON.stringify(input).slice(0, 80),
    );
});

test("guardWrites drops only comments every shell reads alike and refuses shell words shaped like protected paths anywhere", async (t) => {
  const box = await guardBox(t);
  const other = await sandbox(t, { git: false });
  const elsewhere = other.path("archive/audit/events.jsonl");
  await symlink(
    box.path(`vouch/intents/${intent}/audit/next.jsonl`),
    box.path("pending"),
  );
  await symlink(box.path("vouch/intents/260929-new"), box.path("pending-dir"));
  const windows = (/** @type {string} */ path) => path.replaceAll("/", "\\");
  /** @type {[string,Record<string,unknown>,string][]} */
  const cases = [
    ["Bash", { command: `echo ok > notes.txt # ${audit}` }, "allow"],
    ["Bash", { command: `# keep ${audit}\necho ok > notes.txt` }, "allow"],
    [
      "Bash",
      { command: `echo "ok" > notes.txt # ${audit}` },
      "VOUCH-GUARD-AUDIT",
    ],
    ["Bash", { command: `(( x #)); rm ${audit}` }, "VOUCH-GUARD-AUDIT"],
    [
      "Bash",
      { command: `Add-Content <#x#> ${windows(audit)} y` },
      "VOUCH-GUARD-AUDIT",
    ],
    [
      "Bash",
      { command: `Write-Output ok # x\rRemove-Item ${windows(audit)}` },
      "VOUCH-GUARD-AUDIT",
    ],
    // Shell words keep their spelled shape: Git Bash reads /c/... unlike Node.js.
    ["Bash", { command: `printf x >> '${elsewhere}'` }, "VOUCH-GUARD-AUDIT"],
    [
      "Bash",
      { command: `printf x > '${other.path("job.vouch-lock")}'` },
      "VOUCH-GUARD-LOCK",
    ],
    ["Write", { file_path: elsewhere, content: "x" }, "allow"],
    // A link to a protected target that does not exist yet is unresolved.
    [
      "Write",
      { file_path: box.path("pending"), content: "x" },
      "VOUCH-GUARD-LINK",
    ],
    ["Bash", { command: "echo x > pending" }, "VOUCH-GUARD-LINK"],
    [
      "Write",
      { file_path: box.path("pending-dir/audit/events.jsonl"), content: "x" },
      "VOUCH-GUARD-LINK",
    ],
  ];
  t.plan(cases.length);
  for (const [tool, input, expected] of cases)
    t.assert.equal(
      await box.decide(tool, input),
      expected,
      JSON.stringify(input).slice(0, 80),
    );
});

test("guardWrites judges a Codex move by its source and an update by every approved line it holds", async (t) => {
  const box = await guardBox(t, "codex");
  const other = await sandbox(t, { git: false });
  await box.write("notes.md", approvedText);
  await box.write("draft-notes.md", draft);
  await writeFile(box.path("bytes.md"), Buffer.from([0x2d, 0x0a, 0xff]));
  await other.write("elsewhere.md", draft);
  const quoted = "vouch/intents/260929-quoted/intent.md";
  await box.write(quoted, `${draft}\n\`\`\`yaml\nstatus: approved\n\`\`\`\n`);
  const fresh = "vouch/intents/260929-new/intent.md";
  /** @param {string[]} lines */
  const patch = (...lines) =>
    ["*** Begin Patch", ...lines, "*** End Patch", ""].join("\n");
  /** @type {[string,string][]} */
  const cases = [
    [
      patch("*** Add File: notes-copy.md", "+---", "+status: approved", "+---"),
      "allow",
    ],
    [
      patch(
        "*** Update File: notes.md",
        `*** Move to: ${fresh}`,
        "@@",
        "-AC-1",
        "+AC-2",
      ),
      "VOUCH-GUARD-APPROVED",
    ],
    [
      patch(
        `*** Update File: ${other.path("elsewhere.md")}`,
        `*** Move to: ${fresh}`,
        "+x",
      ),
      "VOUCH-GUARD-APPROVED",
    ],
    [
      patch("*** Update File: draft-notes.md", `*** Move to: ${fresh}`, "+x"),
      "allow",
    ],
    [
      patch("*** Update File: missing.md", `*** Move to: ${fresh}`, "+x"),
      "allow",
    ],
    // A source that cannot be read as text may hold an approved line.
    [
      patch("*** Update File: bytes.md", `*** Move to: ${fresh}`, "+x"),
      "VOUCH-GUARD-APPROVED",
    ],
    [
      patch("*** Update File: vouch", `*** Move to: ${fresh}`, "+x"),
      "VOUCH-GUARD-APPROVED",
    ],
    [patch(`*** Update File: ${fresh}`, "+x"), "allow"],
    // Dropping the closing `---` would pull the quoted line into the frontmatter.
    [
      patch(`*** Update File: ${quoted}`, "@@", " status: draft", "----"),
      "VOUCH-GUARD-APPROVED",
    ],
    [
      patch(
        `*** Update File: ${artifact}`,
        "@@",
        "-AC-1: keep it.",
        "+AC-1: keep all.",
      ),
      "allow",
    ],
  ];
  t.plan(cases.length);
  for (const [command, expected] of cases)
    t.assert.equal(
      await box.decide("apply_patch", { command }),
      expected,
      command,
    );
});

test("guardWrites reads a backslash both as a separator and as the platform does", async (t) => {
  const box = await guardBox(t);
  const auditDir = box.path(`vouch/intents/${intent}/audit`);
  await symlink(auditDir, box.path("audit-alias"), "junction");
  // Windows climbs out through `..\`; Linux and macOS create a name inside the directory.
  const inside = (/** @type {string} */ reason) =>
    process.platform === "win32" ? "allow" : reason;
  /** @type {[string,Record<string,unknown>,string][]} */
  const cases = [
    [
      "Write",
      { file_path: `${auditDir}/..\\..\\..\\..\\forged.jsonl`, content: "{}" },
      inside("VOUCH-GUARD-AUDIT"),
    ],
    [
      "Write",
      { file_path: `${box.path(".claude/hooks")}/..\\..\\x.mjs`, content: "" },
      inside("VOUCH-GUARD-INSTALLATION"),
    ],
    [
      "Write",
      { file_path: `${box.path("docs")}/..\\notes.md`, content: "" },
      "allow",
    ],
    // Read as a separator, the backslash leads through the linked directory.
    [
      "Write",
      { file_path: box.path("audit-alias\\next.jsonl"), content: "" },
      "VOUCH-GUARD-AUDIT",
    ],
    [
      "Bash",
      { command: `cd vouch/intents/${intent} && printf x > 'audit/..\\x'` },
      inside("VOUCH-GUARD-AUDIT"),
    ],
    ["Bash", { command: "printf x > 'notes\\..\\x'" }, "allow"],
  ];
  t.plan(cases.length);
  for (const [tool, input, expected] of cases)
    t.assert.equal(
      await box.decide(tool, input),
      expected,
      JSON.stringify(input).slice(-80),
    );
});

test("guardWrites treats git commands that are not read-only as removers of the directories they name", async (t) => {
  const box = await guardBox(t);
  /** @type {[string,string][]} */
  const cases = [
    [`git rm -r vouch/intents/${intent}`, "VOUCH-GUARD-AUDIT"],
    ["git checkout -- vouch", "VOUCH-GUARD-AUDIT"],
    ["git checkout -- .", "VOUCH-GUARD-AUDIT"],
    ["git restore -s HEAD~1 vouch", "VOUCH-GUARD-AUDIT"],
    ["git clean -fdx vouch", "VOUCH-GUARD-AUDIT"],
    ["git -C vouch checkout -- .", "VOUCH-GUARD-AUDIT"],
    ["git add vouch && git commit -m record", "allow"],
    ["git log -- vouch", "allow"],
    ["git checkout main && git stash", "allow"],
    ["git rm --cached notes.md", "allow"],
  ];
  t.plan(cases.length);
  for (const [command, expected] of cases)
    t.assert.equal(await box.decide("Bash", { command }), expected, command);
});
