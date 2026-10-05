import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isAuditEvent } from "../../core/hooks/lib/validation.mjs";
import { audit, buildLog, gitBox } from "../helpers/git-guard.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";
import { validator } from "../helpers/registry.mjs";

// Manual DoD command: docs/development/git-guard.md.
const log = buildLog;

/** The source entry, whose project root is this repository. */
function source(env: Record<string, string>) {
  return spawnSync(process.execPath, [resolve("core/hooks/vouch-dod.mjs")], {
    cwd: process.cwd(),
    input: "not a hook event",
    encoding: "utf8",
    windowsHide: true,
    timeout: 4000,
    env: { ...process.env, VOUCH_INTENT: "", ...env },
  });
}

test("the source command reports a missing Intent or plan as JSON without writing", (t) => {
  const before = existsSync("vouch");
  const results = [
    source({}),
    source({ VOUCH_INTENT: "260929-no-such-intent" }),
  ];
  t.plan(results.length * 4 + 1);
  for (const [index, result] of results.entries()) {
    const report = JSON.parse(result.stdout);
    t.assert.equal(result.status, 2);
    t.assert.equal(result.stderr, "");
    t.assert.equal(validator("doctor-report")(report), true);
    t.assert.deepEqual(
      report.checks.map((item: { id: string }) => item.id),
      [index === 0 ? "DOD-SCOPE" : "DOD-PLAN"],
    );
  }
  t.assert.equal(existsSync("vouch"), before, "no project artifacts appear");
});

test("the installed command runs the DoD at a clean commit and records it in build-log.md and the audit", async (t) => {
  const box = await gitBox(t);
  await box.write("src/types.js", "// contract\n");
  const head = box.commit("contract(U1): types");
  const passed = box.dod();
  await box.write("tests/app.test.js", "// red\n");
  box.commit("test(U1): app");
  const failed = box.dod();
  const text = await box.read(log);
  const records = (await box.read(audit))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((record) => record.check === "dod");
  const entries = text.split(/(?=<!-- dod -->\n)/);
  t.plan(10);
  t.assert.deepEqual(
    [passed.status, passed.report.ok, failed.status, failed.report.ok],
    [0, true, 2, false],
  );
  t.assert.equal(validator("doctor-report")(failed.report), true);
  t.assert.equal(records.length, 2);
  t.assert.equal(records.every(isAuditEvent), true);
  t.assert.deepEqual(
    records.map((record) => [record.result, record.clean, record.missing]),
    [
      ["pass", true, 0],
      ["fail", true, 0],
    ],
  );
  t.assert.equal(records[0].commit, head);
  t.assert.deepEqual(records[1].commands[0], {
    target: "Unit tests",
    command: "node check.js",
    cwd: ".",
    result: "fail",
    duration_ms: records[1].commands[0].duration_ms,
    exit_code: 1,
  });
  t.assert.deepEqual(
    records.map((record) => record.output.sha256),
    entries.map((entry, index) =>
      createHash("sha256")
        .update(index < entries.length - 1 ? entry.replace(/\n$/, "") : entry)
        .digest("hex"),
    ),
  );
  t.assert.match(
    text,
    /### Unit tests\n\n- Command: `node check\.js`\n- Directory: `\.`\n- Result: fail \(exit 1, \d+ ms\)\n\n```text\n1 failing: app is missing\n```\n$/,
  );
  t.assert.match(
    `${failed.report.checks[1]?.detail}`,
    new RegExp(`^Unit tests: \`node check\\.js\` fail; ${log}#L\\d+$`),
  );
});

test("the installed command fails before running when the audit is unreadable", async (t) => {
  const box = await gitBox(t);
  await box.write(audit, "broken\n");
  const before = tree(box.root);
  const result = box.dod();
  t.plan(3);
  t.assert.equal(result.status, 2);
  t.assert.deepEqual(
    result.report.checks.map((item: { id: string }) => item.id),
    ["DOCTOR-IO"],
  );
  t.assert.deepEqual(tree(box.root), before);
});

test("the installed command reports commands that cannot start and uncommitted changes", async (t) => {
  const box = await gitBox(t);
  const rules = await box.read("vouch/rules.md");
  await box.write(
    "vouch/rules.md",
    rules.replace(
      "| Unit tests | `node check.js` in `.` | exit 0 | build-log.md |",
      "| Unit tests | `node check.js` in `../outside` | exit 0 | build-log.md |\n| Audit | `vouch-no-such-command` | exit 0 | build-log.md |",
    ),
  );
  await box.write("src/dirty.js", "// uncommitted\n");
  const result = box.dod();
  const record = (await box.read(audit))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .at(-1);
  t.plan(4);
  t.assert.equal(result.status, 2);
  t.assert.deepEqual(
    result.report.checks.map((item: { ok: boolean }) => item.ok),
    [false, false, false, true],
  );
  t.assert.deepEqual(
    record.commands.map((item: { result: string; exit_code?: number }) => [
      item.result,
      typeof item.exit_code,
    ]),
    [
      ["fail", "undefined"],
      ["fail", "number"],
    ],
  );
  t.assert.equal(record.clean, false);
});

test("the installed command keeps secret-named variable values out of build-log.md", async (t) => {
  const box = await gitBox(t);
  const rules = await box.read("vouch/rules.md");
  await box.write(
    "vouch/rules.md",
    rules.replace(
      "`node check.js`",
      '`node -e "console.log(process.env.VOUCH_TEST_TOKEN)"`',
    ),
  );
  const result = box.dod({ VOUCH_TEST_TOKEN: "s3cr3t-value-for-dod" });
  const text = await box.read(log);
  t.plan(3);
  t.assert.equal(result.status, 0);
  t.assert.equal(text.includes("s3cr3t-value-for-dod"), false);
  t.assert.match(text, /```text\n\[redacted\]\n```/);
});
