import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { sandbox } from "../helpers/runtime.mjs";

/** @param {Awaited<ReturnType<typeof sandbox>>} box @param {import('node:test').RunOptions} options */
function execute(box, options) {
  return spawnSync(
    process.execPath,
    [
      resolve("scripts/test-phase.mjs"),
      JSON.stringify({
        cwd: box.root,
        concurrency: 1,
        timeout: 1000,
        execArgv: ["--import", resolve("tests/helpers/no-network.mjs")],
        ...options,
      }),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 4000 },
  );
}

test("test phase preserves supplied file order and isolated child processes", async (t) => {
  const box = await sandbox(t, { git: false });
  for (const name of ["z-large", "a-small"])
    await box.write(
      `${name}.test.mjs`,
      `
import { appendFileSync } from 'node:fs';
import { test } from 'node:test';
test('${name}', () => appendFileSync('order.jsonl', JSON.stringify(['${name}', process.pid]) + '\\n'));
`,
    );
  const result = execute(box, {
    files: [box.path("z-large.test.mjs"), box.path("a-small.test.mjs")],
  });
  t.assert.equal(result.status, 0, result.stdout + result.stderr);
  const entries = (await box.read("order.jsonl"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  t.assert.deepEqual(
    entries.map(([name]) => name),
    ["z-large", "a-small"],
  );
  t.assert.equal(new Set(entries.map(([, pid]) => pid)).size, 2);
  t.assert.equal(
    entries.some(([, pid]) => pid === process.pid),
    false,
  );
});

test("test phase propagates test failures and preloads the network prohibition", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write(
    "failed.test.mjs",
    "import { test } from 'node:test'; test('fails', () => { throw Error('expected failure'); });",
  );
  const failed = execute(box, { files: [box.path("failed.test.mjs")] });
  t.assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  t.assert.match(failed.stdout, /expected failure/);
  await box.write(
    "network.test.mjs",
    "import { test } from 'node:test'; test('no network', async () => { await fetch('https://example.com'); });",
  );
  const network = execute(box, { files: [box.path("network.test.mjs")] });
  t.assert.equal(network.status, 1, network.stdout + network.stderr);
  t.assert.match(network.stdout, /TEST-5|network|Network/);
});

test("test phase enforces the supplied timeout", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write(
    "slow.test.mjs",
    "import { test } from 'node:test'; test('slow', async () => { await new Promise(done => setTimeout(done, 500)); });",
  );
  const result = execute(box, {
    files: [box.path("slow.test.mjs")],
    timeout: 50,
  });
  t.assert.equal(result.status, 1, result.stdout + result.stderr);
  t.assert.match(result.stdout, /timed out|timeout/);
});

test("test phase retains coverage thresholds as a failing gate", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write(
    "logic.mjs",
    "export function covered() { return 1; }\nexport function missed() { return 2; }\n",
  );
  await box.write(
    "coverage.test.mjs",
    "import { test } from 'node:test'; import { covered } from './logic.mjs'; test('coverage', () => covered());",
  );
  const result = execute(box, {
    files: [box.path("coverage.test.mjs")],
    coverage: true,
    coverageIncludeGlobs: [box.path("logic.mjs")],
    functionCoverage: 100,
  });
  t.assert.equal(result.status, 1, result.stdout + result.stderr);
  t.assert.match(result.stdout, /logic.mjs/);
  t.assert.match(
    result.stderr + result.stdout,
    /function coverage|coverage.*threshold|threshold.*coverage/i,
  );
});
