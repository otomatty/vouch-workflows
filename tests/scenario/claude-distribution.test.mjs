import { spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { assertGolden } from "../helpers/golden.mjs";
import { packageRun } from "../helpers/packaging.mjs";
import { isContractFixture, readJson } from "../helpers/registry.mjs";
import { fakeClock, sandbox, sessionFor } from "../helpers/runtime.mjs";

test("copied Claude registration records and replays a scoped synthetic startup", async (t) => {
  const box = await sandbox(t);
  const root = box.path("日本語 project $ apostrophe'");
  t.plan(13);
  t.assert.equal(
    isContractFixture(
      readJson("tests/fixtures/harness/claude/SessionStart.json"),
    ),
    true,
  );
  t.assert.equal(packageRun(["--out", box.path("dist")]).status, 0);
  await cp(box.path("dist/claude"), root, { recursive: true });
  const settings = JSON.parse(
    await box.read("dist/claude/.claude/settings.json"),
  );
  const command = settings.hooks.SessionStart[0].hooks[0];
  const fixture = sessionFor(root);
  t.assert.equal(fixture.synthetic, true);
  const env = {
    ...process.env,
    ...settings.env,
    CLAUDE_PROJECT_DIR: root,
    VOUCH_INTENT: "260927-orders",
    VOUCH_TEST_TIME: fakeClock().now(),
  };
  delete env.VOUCH_PROJECT_ROOT;
  for (let run = 0; run < 2; run++) {
    const result = spawnSync(
      command.command,
      [
        `--import=${pathToFileURL(resolve("tests/helpers/fixed-clock.mjs")).href}`,
        ...command.args.map((/** @type {string} */ arg) =>
          arg.replaceAll(`\${CLAUDE_PROJECT_DIR}`, root),
        ),
      ],
      {
        cwd: root,
        input: JSON.stringify(fixture.payload),
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
      },
    );
    t.assert.equal(result.status, 0, result.stderr);
    t.assert.equal(result.stdout, "");
    t.assert.equal(result.stderr, "");
    await assertGolden(
      t,
      "session-start.jsonl",
      await box.read(
        "日本語 project $ apostrophe'/vouch/intents/260927-orders/audit/events.jsonl",
      ),
    );
  }
  t.assert.equal(command.command, "node");
  t.assert.equal(command.args.length, 1);
});
