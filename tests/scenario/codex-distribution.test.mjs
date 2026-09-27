import { spawnSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { assertGolden } from "../helpers/golden.mjs";
import { packageRun } from "../helpers/packaging.mjs";
import { sandbox, sessionFor } from "../helpers/runtime.mjs";

test("copied Codex shell registration records from a nested directory and replays once", async (t) => {
  const box = await sandbox(t);
  const folder = "日本語 project $ apostrophe'";
  const root = box.path(folder);
  t.plan(8);
  t.assert.equal(packageRun(["--out", box.path("dist")]).status, 0);
  await cp(box.path("dist/codex"), root, { recursive: true });
  const cwd = resolve(root, "nested");
  await mkdir(cwd);
  const settings = JSON.parse(await box.read("dist/codex/.codex/hooks.json"));
  const command = settings.hooks.SessionStart[0].hooks[0];
  const fixture = sessionFor(cwd, "codex");
  t.assert.equal(fixture.synthetic, true);
  for (const instant of [
    "2026-09-27T00:00:00.000Z",
    "2026-09-28T00:00:00.000Z",
  ]) {
    const result = spawnSync(
      process.platform === "win32" ? "powershell.exe" : "/bin/sh",
      process.platform === "win32"
        ? ["-NoProfile", "-NonInteractive", "-Command", command.commandWindows]
        : ["-c", command.command],
      {
        cwd,
        input: JSON.stringify(fixture.payload),
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        env: {
          ...process.env,
          VOUCH_PROJECT_ROOT: root,
          VOUCH_HARNESS: "claude",
          VOUCH_INTENT: "260927-orders",
          VOUCH_TEST_TIME: instant,
          NODE_OPTIONS: `--import="${pathToFileURL(resolve("tests/helpers/fixed-clock.mjs")).href}"`,
        },
      },
    );
    t.assert.equal(result.status, 0, result.stderr || result.error?.message);
    t.assert.deepEqual([result.stdout, result.stderr], ["", ""]);
    await assertGolden(
      t,
      "codex-session-start.jsonl",
      await box.read(
        `${folder}/vouch/intents/260927-orders/audit/events.jsonl`,
      ),
    );
  }
});
