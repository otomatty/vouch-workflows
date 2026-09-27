import { readFileSync } from "node:fs";
import { test } from "node:test";
import runtime from "../../core/registry/runtime.json" with { type: "json" };
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
    ...["installation.json", "registration.json"].map((name) => [
      `.codex/registry/${name}`,
      readFileSync(
        name === "installation.json"
          ? "harness/codex/installation.json"
          : "harness/codex/hooks.json",
      ).toString("base64"),
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
    Object.fromEntries(
      Object.entries(tree(box.path("dist/codex"))).filter(
        ([path]) =>
          !path.startsWith(".agents/skills/") &&
          !path.startsWith(".codex/templates/") &&
          !["AGENTS.md", "CLAUDE.md"].includes(path),
      ),
    ),
    expected,
    "DIST-2: runtime inventory; Skill inventory is checked separately",
  );
  t.assert.equal(packageRun(["--out", box.path("dist"), "--check"]).status, 0);
  const settings = JSON.parse(await box.read("dist/codex/.codex/hooks.json"));
  t.assert.deepEqual(Object.keys(settings), ["hooks"]);
  t.assert.deepEqual(Object.keys(settings.hooks), [
    "SessionStart",
    "UserPromptSubmit",
  ]);
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
  const entries = [...runtime.hooks].sort();
  t.assert.deepEqual(
    [
      command.type,
      ...[command.command, command.commandWindows].map(
        (/** @type {string} */ text) =>
          [
            ...[
              text,
              settings.hooks.UserPromptSubmit[0].hooks[0][
                text === command.command ? "command" : "commandWindows"
              ],
            ]
              .join(" ")
              .matchAll(/vouch-[a-z-]+\.mjs/g),
          ]
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
