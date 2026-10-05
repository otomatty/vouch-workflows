import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { cp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import operations from "../../core/registry/operations.json" with {
  type: "json",
};
import { assertGolden } from "../helpers/golden.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { packageRun } from "../helpers/packaging.mjs";
import { fakeClock, sandbox, sessionFor } from "../helpers/runtime.mjs";

test("copied Claude registration records once when the project and cwd are spelled through a directory alias", async (t) => {
  const box = await sandbox(t);
  const folder = "日本語 project $ apostrophe'";
  const root = box.path(folder);
  const alias = box.path("alias");
  t.plan(9);
  t.assert.equal(packageRun(["--out", box.path("dist")]).status, 0);
  await cp(box.path("dist/claude"), root, { recursive: true });
  await mkdir(resolve(root, "nested"));
  // A junction on Windows and a symbolic link elsewhere; 8.3 and subst spellings behave alike.
  await symlink(root, alias, "junction");
  const settings = JSON.parse(
    await box.read("dist/claude/.claude/settings.json"),
  );
  const command = settings.hooks.SessionStart[0].hooks[0];
  const cwd = resolve(alias, "nested");
  const fixture = sessionFor(cwd);
  // Record the runner's own spellings next to the canonical root used by the FileStore.
  t.diagnostic(
    JSON.stringify({
      tmpdir: tmpdir(),
      tmpdirNative: realpathSync.native(tmpdir()),
      root,
      rootNative: realpathSync.native(root),
      alias,
      cwd,
      cwdNative: realpathSync.native(cwd),
    }),
  );
  for (const project of [alias, root]) {
    const env = {
      ...process.env,
      ...settings.env,
      CLAUDE_PROJECT_DIR: project,
      VOUCH_INTENT: "260927-orders",
      VOUCH_TEST_TIME: fakeClock().now(),
    };
    delete env.VOUCH_PROJECT_ROOT;
    const result = spawnSync(
      command.command,
      [
        `--import=${pathToFileURL(resolve("tests/helpers/fixed-clock.mjs")).href}`,
        ...command.args.map((arg: string) =>
          arg.replaceAll(`\${CLAUDE_PROJECT_DIR}`, project),
        ),
      ],
      {
        cwd,
        input: JSON.stringify(fixture.payload),
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
      },
    );
    t.assert.equal(result.status, 0, result.stderr);
    t.assert.match(
      result.stdout,
      new RegExp(`^${operations.labels.ja.summary}\n`),
    );
    t.assert.equal(result.stderr, "");
    await assertGolden(
      t,
      "session-start.jsonl",
      await box.read(
        `${folder}/vouch/intents/260927-orders/audit/events.jsonl`,
      ),
    );
  }
});
