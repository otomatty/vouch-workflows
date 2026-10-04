import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { intent, reviewBox } from "../helpers/intent-review.mjs";
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

test("product hooks run without loading the managed launcher or Cursor transport", async (t) => {
  const box = await sandbox(t);
  await box.write(
    "reject-launcher.mjs",
    `
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (/\\/lib\\/(?:launch|transport)\\.mjs$/.test(result.url))
    throw new Error("UNEXPECTED-LAUNCHER-LOAD");
  return result;
} });
`,
  );
  for (const [hook, fixture] of [
    ["vouch-record-session-start", sessionFor(box.root)],
    ["vouch-record-intent-review", promptFor(box.root)],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(box.path("reject-launcher.mjs")).href,
        resolve(`core/hooks/${hook}.mjs`),
      ],
      {
        input: JSON.stringify(
          /** @type {import('../../core/hooks/lib/contracts.mjs').HarnessFixture} */ (
            fixture
          ).payload,
        ),
        env: {
          ...process.env,
          VOUCH_PROJECT_ROOT: box.root,
          VOUCH_INTENT: "",
          VOUCH_HARNESS: "claude",
        },
        encoding: "utf8",
        timeout: 4000,
      },
    );
    t.assert.equal(result.status, 0, result.stderr);
    t.assert.equal(result.stderr, "");
  }
});

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

test("recording a startup loads no stream, fs promises, network or crypto modules", async (t) => {
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
  t.assert.deepEqual(
    await loaded(moduleLog, [stream, promises, net, crypto]),
    [],
  );
});

test("recording a review and its approval with digests loads no stream, fs promises, network or crypto modules", async (t) => {
  const box = await reviewBox(t);
  const openLog = box.path("modules-open.json");
  const open = runHook(
    "vouch-record-intent-review",
    box.fixture("vouch review", "modules-open"),
    { root: box.root, intent, coverage: false, moduleLog: openLog },
  );
  const [gate] = await box.rows();
  if (!gate) throw Error("gate");
  const approveLog = box.path("modules-approve.json");
  const approve = runHook(
    "vouch-record-intent-review",
    box.fixture(`vouch approve ${gate.id}`, "modules-approve"),
    { root: box.root, intent, coverage: false, moduleLog: approveLog },
  );
  t.plan(5);
  t.assert.match(open.stderr, /VOUCH-REVIEW-RECORDED/);
  t.assert.match(approve.stderr, /VOUCH-APPROVAL-RECORDED/);
  t.assert.equal((await box.rows()).length, 2, "gate and approval recorded");
  for (const log of [openLog, approveLog])
    t.assert.deepEqual(await loaded(log, [stream, promises, net, crypto]), []);
});
