import { symlink } from "node:fs/promises";
import operations from "../../core/registry/operations.json" with {
  type: "json",
};
import { deriveFixture } from "../helpers/fixtures.mjs";
import { assertGolden } from "../helpers/golden.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { readJson, validator } from "../helpers/registry.mjs";
import {
  promptFor,
  runHook,
  sandbox,
  sessionFor,
} from "../helpers/runtime.mjs";

const hook = "vouch-record-session-start";
const intent = "260927-orders";
const path = `vouch/intents/${intent}/audit/events.jsonl`;

test("session startup emits a complete registered event matching the golden", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root);
  const result = runHook(hook, fixture, { root: box.root, intent });
  const log = await box.read(path);
  const event = JSON.parse(log);
  t.plan(7);
  t.assert.equal(result.exitCode, 0);
  t.assert.match(
    result.stdout,
    new RegExp(`^${operations.labels.ja.summary}\n`),
    "resume summary",
  );
  t.assert.equal(result.stderr, "");
  t.assert.equal(validator("audit-event")(event), true);
  t.assert.equal(event.type, "session.started");
  t.assert.deepEqual(
    [
      event.intent,
      event.session,
      event.harness,
      event.actor,
      event.synthetic,
      event.duration_ms,
      event.tokens,
    ],
    [
      intent,
      fixture.payload.session_id,
      "claude",
      "hook",
      undefined,
      undefined,
      undefined,
    ],
  );
  await assertGolden(t, "session-start.jsonl", log);
});

test("session replay retains the first timestamp and distinct sessions append once", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root);
  runHook(hook, fixture, { root: box.root, intent });
  const first = await box.read(path);
  const replay = runHook(hook, fixture, {
    root: box.root,
    intent,
    instant: "2026-09-28T00:00:00Z",
  });
  const second = runHook(
    hook,
    {
      ...fixture,
      payload: { ...fixture.payload, session_id: "second-session" },
    },
    { root: box.root, intent },
  );
  const rows = (await box.read(path))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  t.plan(5);
  t.assert.equal(replay.stderr, "");
  t.assert.equal(second.stderr, "");
  t.assert.equal(rows.length, 2);
  t.assert.equal(`${JSON.stringify(rows[0])}\n`, first);
  t.assert.notEqual(rows[0].id, rows[1].id);
});

test("installed harness selects audit identity independently of input claims", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root);
  // Synthetic cross-harness configuration test, not Codex capture evidence.
  const result = runHook(hook, fixture, {
    root: box.root,
    intent,
    configuredHarness: "codex",
    raw: JSON.stringify({ ...fixture.payload, harness: "claude" }),
  });
  t.plan(3);
  t.assert.equal(result.exitCode, 0);
  t.assert.equal(result.stderr, "");
  t.assert.equal(JSON.parse(await box.read(path)).harness, "codex");
});

test("explicit intent scope separates logs and never trusts a payload intent", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root);
  const raw = JSON.stringify({ ...fixture.payload, intent: "../../escape" });
  runHook(hook, fixture, { root: box.root, intent, raw });
  runHook(hook, fixture, { root: box.root, intent: "another" });
  const a = JSON.parse(await box.read(path));
  const b = JSON.parse(
    await box.read("vouch/intents/another/audit/events.jsonl"),
  );
  t.plan(3);
  t.assert.equal(a.intent, intent);
  t.assert.equal(b.intent, "another");
  t.assert.notEqual(a.id, b.id);
});

test("unscoped startup and unrelated events record nothing; summarized sources only print", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root);
  const cases = [
    { fixture, options: { root: box.root } },
    { fixture: promptFor(box.root), options: { root: box.root, intent } },
    ...["clear", "fork", "future"].map((source) => ({
      fixture: { ...fixture, payload: { ...fixture.payload, source } },
      options: { root: box.root, intent },
    })),
  ];
  t.plan(cases.length * 3 + 1);
  for (const item of cases) {
    const result = runHook(hook, item.fixture, item.options);
    const source = /** @type {{source?:string}} */ (item.fixture.payload)
      .source;
    t.assert.equal(result.exitCode, 0);
    if (
      item.options.intent &&
      operations.resume.sources.claude.includes(String(source)) &&
      source !== "startup"
    )
      t.assert.match(
        result.stdout,
        new RegExp(`^${operations.labels.ja.summary}\n`),
      );
    else t.assert.equal(result.stdout, "");
    t.assert.equal(result.stderr, "");
  }
  await t.assert.rejects(box.read(path), { code: "ENOENT" });
});

test("invalid input covers empty, non-JSON, missing fields, wrong types, traversal and 1 MiB", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root);
  const cases = [
    "",
    "not json",
    "{}",
    JSON.stringify({ ...fixture.payload, source: 3 }),
    JSON.stringify({ ...fixture.payload, cwd: "../escape" }),
    "x".repeat(1024 * 1024),
  ];
  t.plan(cases.length * 3 + 1);
  for (const raw of cases) {
    const result = runHook(hook, fixture, { root: box.root, intent, raw });
    t.assert.equal(result.exitCode, 0);
    t.assert.equal(result.stdout, "");
    t.assert.match(result.stderr, /HOOK-14|FS-ESCAPE/);
  }
  await t.assert.rejects(box.read(path), { code: "ENOENT" });
});

test("corrupt or conflicting audit records fail open and preserve every byte", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root);
  runHook(hook, fixture, { root: box.root, intent });
  const valid = JSON.parse(await box.read(path));
  const cases = [
    "not json\n",
    `${JSON.stringify({ ...valid, actor: "model" })}\n`,
  ];
  t.plan(cases.length * 4);
  for (const before of cases) {
    await box.write(path, before);
    const result = runHook(hook, fixture, { root: box.root, intent });
    t.assert.equal(result.exitCode, 0);
    t.assert.equal(result.stdout, "");
    t.assert.match(result.stderr, /AUDIT-CORRUPT|AUDIT-CONFLICT/);
    t.assert.equal(await box.read(path), before);
  }
});

test("invalid scope and linked audit directories cannot write outside the intent", async (t) => {
  const box = await sandbox(t);
  const outside = await sandbox(t);
  const fixture = sessionFor(box.root);
  const invalid = runHook(hook, fixture, {
    root: box.root,
    intent: "../outside",
  });
  await box.write(`vouch/intents/${intent}/intent.md`, "existing intent");
  await symlink(
    outside.root,
    box.path(`vouch/intents/${intent}/audit`),
    "junction",
  );
  const linked = runHook(hook, fixture, { root: box.root, intent });
  t.plan(5);
  t.assert.match(invalid.stderr, /AUDIT-SCOPE/);
  t.assert.equal(invalid.exitCode, 0);
  t.assert.match(linked.stderr, /FS-LINK/);
  t.assert.equal(linked.exitCode, 0);
  await t.assert.rejects(outside.read("events.jsonl"), { code: "ENOENT" });
});

test("Claude session records obtained tokens; Codex and malformed usage do not", async (t) => {
  const box = await sandbox(t);
  const claude = deriveFixture(
    readJson(
      "tests/fixtures/harness/claude/2.1.283/linux/print/SessionStart.startup.json",
    ),
    { cwd: box.root, tokens: { in: 11, out: 7, cache: 3 } },
  );
  const codex = deriveFixture(
    readJson(
      "tests/fixtures/harness/codex/0.153.4/linux/exec/SessionStart.startup.json",
    ),
    { cwd: box.root, tokens: { in: 11, out: 7 } },
  );
  const malformed = deriveFixture(
    readJson(
      "tests/fixtures/harness/claude/2.1.283/linux/print/SessionStart.resume.json",
    ),
    { cwd: box.root, tokens: { in: 1.5, out: 1 } },
  );
  const started = runHook(hook, claude, { root: box.root, intent });
  const other = runHook(hook, codex, {
    root: box.root,
    intent,
    configuredHarness: "codex",
  });
  const resumed = runHook(hook, malformed, { root: box.root, intent });
  const rows = (await box.read(path))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  t.plan(6);
  t.assert.deepEqual(
    [started.exitCode, other.exitCode, resumed.exitCode],
    [0, 0, 0],
  );
  t.assert.equal([started.stderr, other.stderr, resumed.stderr].join(""), "");
  t.assert.deepEqual(
    rows.map((row) => row.type),
    ["session.started", "session.started", "session.resumed"],
  );
  t.assert.deepEqual(rows[0].tokens, { in: 11, out: 7, cache: 3 });
  t.assert.equal(rows[1].tokens, undefined);
  t.assert.deepEqual(
    [rows[2].tokens, rows[2].duration_ms],
    [undefined, 0],
    "malformed usage is not a measurement; restore duration is the clock delta",
  );
});

test("a resumed session replays the first duration and tokens", async (t) => {
  const box = await sandbox(t);
  const fixture = deriveFixture(
    readJson(
      "tests/fixtures/harness/claude/2.1.283/linux/print/SessionStart.resume.json",
    ),
    { cwd: box.root, tokens: { in: 4, out: 1 } },
  );
  runHook(hook, fixture, { root: box.root, intent });
  const first = await box.read(path);
  const replay = runHook(
    hook,
    deriveFixture(
      readJson(
        "tests/fixtures/harness/claude/2.1.283/linux/print/SessionStart.resume.json",
      ),
      { cwd: box.root, tokens: { in: 99, out: 99 } },
    ),
    { root: box.root, intent, instant: "2026-10-02T00:00:00.000Z" },
  );
  t.plan(3);
  t.assert.equal(replay.stderr, "");
  t.assert.equal(await box.read(path), first);
  t.assert.equal(JSON.parse(first).duration_ms, 0);
});
