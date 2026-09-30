import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { sandbox } from "../helpers/runtime.mjs";

/** Exercise the real check entry with small task processes and an isolated journal.
 * @param {import('node:test').TestContext} t @param {string} [failure] */
async function runCheck(t, failure = "") {
  const box = await sandbox(t, { git: false });
  await box.write(
    "npm.mjs",
    `
import { appendFileSync, readFileSync } from 'node:fs';
const task = process.argv[3];
const write = (event) => appendFileSync('events.jsonl', JSON.stringify([task, event]) + '\\n');
write('start');
if (['lint', 'typecheck'].includes(task)) {
  let together = false;
  for (let i = 0; i < 30; i++) {
    const text = readFileSync('events.jsonl', 'utf8');
    if (text.includes('["lint","start"]') && text.includes('["typecheck","start"]')) { together = true; break; }
    await new Promise((done) => setTimeout(done, 10));
  }
  if (!together) process.exit(23);
}
write('end');
process.exit(process.env.CHECK_TEST_FAILURE === task ? 17 : 0);
`,
  );
  const result = spawnSync(process.execPath, [resolve("scripts/check.mjs")], {
    cwd: box.root,
    env: {
      ...process.env,
      npm_execpath: box.path("npm.mjs"),
      CHECK_TEST_FAILURE: failure,
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: 3500,
  });
  const events = (await box.read("events.jsonl"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  return { result, events };
}

test("check validates independent static tasks together before tests and distribution", async (t) => {
  const { result, events } = await runCheck(t);
  t.assert.equal(result.status, 0, result.stderr);
  t.assert.deepEqual(
    events
      .slice(0, 2)
      .map(([name]) => name)
      .sort(),
    ["lint", "typecheck"],
  );
  t.assert.deepEqual(events.slice(4), [
    ["test", "start"],
    ["test", "end"],
    ["package", "start"],
    ["package", "end"],
    ["package:check", "start"],
    ["package:check", "end"],
  ]);
});

test("failure of either static validator blocks tests and distribution", async (t) => {
  for (const failure of ["lint", "typecheck"]) {
    const { result, events } = await runCheck(t, failure);
    t.assert.equal(result.status, 17, result.stderr);
    t.assert.equal(
      events.some(([task]) =>
        ["test", "package", "package:check"].includes(task),
      ),
      false,
    );
  }
});
