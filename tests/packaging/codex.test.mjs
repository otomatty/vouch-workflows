import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("Codex distribution reproduces exact source bytes and registers every product hook", async (t) => {
  const box = await sandbox(t);
  t.plan(11);
  const result = packageRun(["--out", box.path("dist")]);
  t.assert.equal(result.status, 0, result.stderr);
  const expected = Object.fromEntries([
    ...Object.entries(tree("core/hooks")).map(([path, bytes]) => [
      `.codex/hooks/${path}`,
      bytes,
    ]),
    ...Object.entries(tree("core/registry")).map(([path, bytes]) => [
      `.codex/registry/${path}`,
      bytes,
    ]),
    ...["hooks.json", "config.toml"].map((name) => [
      `.codex/${name}`,
      readFileSync(`harness/codex/${name}`).toString("base64"),
    ]),
  ]);
  t.assert.deepEqual(
    tree(box.path("dist/codex")),
    expected,
    "DIST-2: source bytes and exact inventory",
  );
  t.assert.equal(packageRun(["--out", box.path("dist"), "--check"]).status, 0);
  const settings = JSON.parse(await box.read("dist/codex/.codex/hooks.json"));
  t.assert.deepEqual(Object.keys(settings), ["hooks"]);
  t.assert.deepEqual(Object.keys(settings.hooks), ["SessionStart"]);
  const [registration] = settings.hooks.SessionStart;
  t.assert.equal(settings.hooks.SessionStart.length, 1);
  t.assert.equal(registration.matcher, "startup");
  t.assert.equal(registration.hooks.length, 1);
  const [command] = registration.hooks;
  t.assert.deepEqual(Object.keys(command).sort(), [
    "command",
    "commandWindows",
    "type",
  ]);
  const entries = readdirSync("core/hooks")
    .filter((name) => name.endsWith(".mjs"))
    .sort();
  t.assert.deepEqual(
    [
      command.type,
      ...[command.command, command.commandWindows].map(
        (/** @type {string} */ text) =>
          [...text.matchAll(/vouch-[a-z-]+\.mjs/g)]
            .map((match) => match[0])
            .sort(),
      ),
    ],
    ["command", entries, entries],
    "DIST-3: both platform registrations match product entries",
  );
  t.assert.equal(
    await box.read("dist/codex/.codex/config.toml"),
    'sandbox_mode = "workspace-write"\n\n[features]\nhooks = true\n\n[agents]\nmax_depth = 1\n',
  );
});
