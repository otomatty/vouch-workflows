import { link, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
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
