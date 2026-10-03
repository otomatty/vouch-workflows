import { test } from "node:test";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("Cursor ships shared Skills, generated agents, rules, registry and a native hook bridge", async (t) => {
  const box = await sandbox(t);
  const result = packageRun(["--out", box.path("dist")]);
  t.assert.equal(result.status, 0, result.stderr);
  const files = tree(box.path("dist/cursor"));
  t.assert.ok(files[".cursor/skills/vouch/SKILL.md"]);
  for (const role of ["builder", "reviewer", "explorer"])
    t.assert.ok(files[`.cursor/agents/vouch-${role}.md`]);
  const hooks = JSON.parse(await box.read("dist/cursor/.cursor/hooks.json"));
  t.assert.equal(hooks.version, 1);
  for (const event of [
    "sessionStart",
    "beforeSubmitPrompt",
    "preToolUse",
    "stop",
  ])
    t.assert.equal(hooks.hooks[event].length, 1);
  t.assert.ok(files[".cursor/hooks/vouch-launch.mjs"]);
  t.assert.ok(files[".cursor/registry/installation.json"]);
});
