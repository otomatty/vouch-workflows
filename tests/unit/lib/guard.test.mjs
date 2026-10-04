import { link, mkdir, symlink, unlink, writeFile } from "node:fs/promises";
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

const artifact = `vouch/intents/${intent}/intent.md`;

const done = "vouch/intents/260929-done/intent.md";

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
