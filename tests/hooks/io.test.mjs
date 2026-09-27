import { test } from "node:test";
import {
  capturedPrompt,
  promptFor,
  runHook,
  sandbox,
} from "../helpers/runtime.mjs";

test("transport driver emits only empty stdout and exit 0 or reasoned exit 2", async (t) => {
  const box = await sandbox(t);
  const fixture = promptFor(box.root);
  t.plan(9);
  for (const [mode, code, message] of [
    ["allow", 0, ""],
    ["deny", 2, "approval required"],
    ["throw", 0, "HOOK-2"],
  ]) {
    const result = runHook(mode, fixture, { root: box.root });
    t.assert.equal(result.exitCode, code);
    t.assert.equal(result.stdout, "");
    t.assert.ok(result.stderr.includes(String(message)));
  }
});

test("transport rejects the six malformed inputs without main side effects", async (t) => {
  const box = await sandbox(t);
  const fixture = promptFor(box.root);
  const cases = [
    "",
    "not json",
    "{}",
    JSON.stringify({ ...fixture.payload, prompt: 3 }),
    JSON.stringify({ ...fixture.payload, cwd: "../escape" }),
    "x".repeat(1024 * 1024),
  ];
  t.plan(cases.length * 3 + 1);
  for (const raw of cases) {
    const result = runHook("emit", fixture, { root: box.root, raw });
    t.assert.equal(result.exitCode, 0);
    t.assert.equal(result.stdout, "");
    t.assert.match(result.stderr, /HOOK-14|FS-ESCAPE/);
  }
  await t.assert.rejects(box.read("vouch/audit/events.jsonl"), {
    code: "ENOENT",
  });
});

test("transport replay writes an event only once", async (t) => {
  const box = await sandbox(t);
  const fixture = promptFor(box.root);
  const first = runHook("emit", fixture, { root: box.root });
  const before = await box.read("vouch/audit/events.jsonl");
  const second = runHook("emit", fixture, { root: box.root });
  t.plan(5);
  t.assert.equal(first.exitCode, 0);
  t.assert.equal(first.stderr, "");
  t.assert.equal(second.stderr, "");
  t.assert.equal(await box.read("vouch/audit/events.jsonl"), before);
  t.assert.equal(before.trim().split("\n").length, 1);
});

test("transport helper requires a matching versioned capture", (t) => {
  const fixture = capturedPrompt();
  t.plan(1);
  t.assert.throws(
    () =>
      runHook(
        "allow",
        { ...fixture, harness: "codex" },
        { root: process.cwd() },
      ),
    /TEST-7/,
  );
});
