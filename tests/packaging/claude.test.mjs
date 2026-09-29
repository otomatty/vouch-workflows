import { readFileSync } from "node:fs";
import { test } from "node:test";
import runtime from "../../core/registry/runtime.json" with { type: "json" };
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("Claude distribution reproduces exact source bytes and registers every product hook", async (t) => {
  t.plan(11);
  const box = await sandbox(t);
  const first = packageRun(["--out", box.path("first")]);
  t.assert.equal(first.status, 0, first.stderr);
  const second = packageRun(["--out", box.path("second")]);
  t.assert.equal(second.status, 0, second.stderr);
  const files = tree(box.path("first/claude"));
  const expected = Object.fromEntries([
    ...Object.entries(tree("core/hooks")).map(([path, bytes]) => [
      `.claude/hooks/${path}`,
      bytes,
    ]),
    ...["installation.json", "registration.json"].map((name) => [
      `.claude/registry/${name}`,
      readFileSync(
        name === "installation.json"
          ? "harness/claude/installation.json"
          : "harness/claude/settings.json",
      ).toString("base64"),
    ]),
    ...Object.entries(tree("core/registry")).map(([path, bytes]) => [
      `.claude/registry/${path}`,
      bytes,
    ]),
    [
      ".claude/settings.json",
      readFileSync("harness/claude/settings.json").toString("base64"),
    ],
  ]);
  t.assert.deepEqual(
    Object.fromEntries(
      Object.entries(files).filter(
        ([path]) =>
          !path.startsWith(".claude/skills/") &&
          !path.startsWith(".claude/templates/") &&
          !["AGENTS.md", "CLAUDE.md"].includes(path),
      ),
    ),
    expected,
    "DIST-2: runtime inventory; Skill inventory is checked separately",
  );
  t.assert.deepEqual(files, tree(box.path("second/claude")));
  const settings = JSON.parse(
    await box.read("first/claude/.claude/settings.json"),
  );
  t.assert.deepEqual(Object.keys(settings).sort(), ["env", "hooks"]);
  t.assert.deepEqual(settings.env, { VOUCH_HARNESS: "claude" });
  t.assert.deepEqual(Object.keys(settings.hooks), [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
  ]);
  const [registration] = settings.hooks.SessionStart;
  t.assert.equal(settings.hooks.SessionStart.length, 1);
  t.assert.equal(registration.matcher, "startup");
  t.assert.deepEqual(registration.hooks, [
    {
      type: "command",
      command: "node",
      args: [
        `\${CLAUDE_PROJECT_DIR}/.claude/hooks/vouch-record-session-start.mjs`,
      ],
    },
  ]);
  const registered = [
    ...registration.hooks,
    ...settings.hooks.UserPromptSubmit[0].hooks,
    ...settings.hooks.PreToolUse[0].hooks,
  ]
    .map((/** @type {{args:string[]}} */ hook) =>
      hook.args[0]?.split("/").at(-1),
    )
    .sort();
  const entries = [...runtime.hooks].sort();
  t.assert.deepEqual(
    registered,
    entries,
    "DIST-3: registrations and product entries agree both ways",
  );
});
