import { readFile } from "node:fs/promises";
import { hookTest as test } from "../helpers/hook-test.mjs";
import {
  promptFor,
  runHook,
  sandbox,
  sessionFor,
} from "../helpers/runtime.mjs";

// Builtins whose loading dominated hook startup; see docs/development/hook-startup.md.
const stream = "NativeModule stream";
const promises = "NativeModule internal/fs/promises";
const net = "NativeModule net";
const crypto = "NativeModule crypto";

/** @param {string} path @param {string[]} names */
async function loaded(path, names) {
  const list = JSON.parse(await readFile(path, "utf8"));
  return names.filter((name) => list.includes(name));
}

test("no-op and digest-free denials read stdin and report without stream, fs promises, network or crypto modules", async (t) => {
  const box = await sandbox(t);
  const unrelated = promptFor(box.root);
  const invalid = {
    ...unrelated,
    payload: { ...unrelated.payload, prompt: "vouch review now" },
  };
  const cases = [
    {
      mode: "vouch-record-session-start",
      fixture: sessionFor(box.root),
      intent: "",
      exitCode: 0,
      stderr: /^$/,
    },
    {
      mode: "vouch-record-intent-review",
      fixture: unrelated,
      intent: "260927-review",
      exitCode: 0,
      stderr: /^$/,
    },
    {
      mode: "vouch-record-intent-review",
      fixture: invalid,
      intent: "260927-review",
      exitCode: 2,
      stderr: /^VOUCH-REVIEW-COMMAND: .+\n$/,
    },
  ];
  t.plan(cases.length * 3);
  for (const [index, item] of cases.entries()) {
    const moduleLog = box.path(`modules-${index}.json`);
    const result = runHook(item.mode, item.fixture, {
      root: box.root,
      intent: item.intent,
      coverage: false,
      moduleLog,
    });
    t.assert.equal(result.exitCode, item.exitCode, result.stderr);
    t.assert.match(result.stderr, item.stderr);
    t.assert.deepEqual(
      await loaded(moduleLog, [stream, promises, net, crypto]),
      [],
    );
  }
});

test("recording a startup loads neither fs promises nor network modules", async (t) => {
  const box = await sandbox(t);
  const moduleLog = box.path("modules.json");
  const result = runHook("vouch-record-session-start", sessionFor(box.root), {
    root: box.root,
    intent: "260927-orders",
    coverage: false,
    moduleLog,
  });
  t.plan(3);
  t.assert.deepEqual([result.exitCode, result.stderr], [0, ""]);
  t.assert.equal(
    (await box.read("vouch/intents/260927-orders/audit/events.jsonl")).split(
      "\n",
    ).length,
    2,
    "one recorded event",
  );
  t.assert.deepEqual(await loaded(moduleLog, [promises, net]), []);
});
