import { assertGolden } from "../helpers/golden.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { readJson, validator } from "../helpers/registry.mjs";
import { runHook, sandbox, sessionFor } from "../helpers/runtime.mjs";

const hook = "vouch-record-session-start";
const intent = "260927-orders";
const path = `vouch/intents/${intent}/audit/events.jsonl`;

test("Codex startup records a complete event and retains the first timestamp on replay", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root, "codex");
  t.plan(11);
  for (const instant of [
    "2026-09-27T00:00:00.000Z",
    "2026-09-28T00:00:00.000Z",
  ]) {
    const result = runHook(hook, fixture, { root: box.root, intent, instant });
    t.assert.deepEqual(
      [result.exitCode, result.stdout, result.stderr],
      [0, "", ""],
    );
    const log = await box.read(path);
    const event = JSON.parse(log);
    t.assert.equal(validator("audit-event")(event), true);
    t.assert.deepEqual(
      [
        event.harness,
        event.actor,
        event.session,
        event.tokens,
        event.duration_ms,
      ],
      ["codex", "hook", fixture.payload.session_id, undefined, undefined],
    );
    t.assert.equal(event.ts, "2026-09-27T00:00:00.000Z");
    await assertGolden(t, "codex-session-start.jsonl", log);
  }
  t.assert.equal(fixture.synthetic, true);
});

test("same session under distinct installed harnesses has distinct audit identities", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root, "codex");
  t.plan(5);
  for (const configuredHarness of /** @type {const} */ (["codex", "claude"])) {
    const result = runHook(hook, fixture, {
      root: box.root,
      intent,
      configuredHarness,
      raw: JSON.stringify({
        ...fixture.payload,
        harness: "forged",
        intent: "../outside",
      }),
    });
    t.assert.equal(result.stderr, "");
  }
  const rows = (await box.read(path))
    .trim()
    .split("\n")
    .map((row) => JSON.parse(row));
  t.assert.deepEqual(
    rows.map((row) => row.harness),
    ["codex", "claude"],
  );
  t.assert.deepEqual(
    rows.map((row) => row.intent),
    [intent, intent],
  );
  t.assert.notEqual(rows[0].id, rows[1].id);
});

test("Codex unscoped startup and resume do not create audit state", async (t) => {
  const box = await sandbox(t);
  const fixture = sessionFor(box.root, "codex");
  t.plan(3);
  const unscoped = runHook(hook, fixture, { root: box.root });
  const resumed = {
    ...fixture,
    payload: { ...fixture.payload, source: "resume" },
  };
  const resume = runHook(hook, resumed, { root: box.root, intent });
  t.assert.deepEqual(
    [unscoped.exitCode, unscoped.stdout, unscoped.stderr],
    [0, "", ""],
  );
  t.assert.deepEqual(
    [resume.exitCode, resume.stdout, resume.stderr],
    [0, "", ""],
  );
  await t.assert.rejects(box.read(path), { code: "ENOENT" });
});

test("Codex driver refuses altered capture claims and unknown legacy versions", (t) => {
  const fixture = readJson(
    "tests/fixtures/harness/codex/0.153.4/SessionStart.json",
  );
  t.plan(3);
  for (const invalid of [
    { ...fixture, payload: { ...fixture.payload, cwd: process.cwd() } },
    { ...sessionFor(process.cwd(), "codex"), version: "invented" },
    readJson("tests/fixtures/harness/codex/sessionStart.json"),
  ])
    t.assert.throws(
      () => runHook(hook, invalid, { root: process.cwd(), intent }),
      /TEST-7/,
    );
});
