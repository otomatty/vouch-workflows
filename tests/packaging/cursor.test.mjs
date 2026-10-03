import { hookTest as test } from "../helpers/hook-test.mjs";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("Cursor ships shared Skills, generated agents, rules, registry and a native hook bridge", async (t) => {
  const box = await sandbox(t);
  const result = packageRun(["--out", box.path("dist")]);
  t.assert.equal(result.status, 0, result.stderr);
  const files = tree(box.path("dist/cursor"));
  t.assert.equal(typeof files[".cursor/skills/vouch/SKILL.md"], "string");
  for (const role of ["builder", "reviewer", "explorer"])
    t.assert.equal(typeof files[`.cursor/agents/vouch-${role}.md`], "string");
  const hooks = JSON.parse(await box.read("dist/cursor/.cursor/hooks.json"));
  t.assert.equal(hooks.version, 1);
  for (const event of [
    "sessionStart",
    "beforeSubmitPrompt",
    "preToolUse",
    "afterAgentResponse",
    "stop",
  ])
    t.assert.equal(hooks.hooks[event].length, 1);
  t.assert.equal(typeof files[".cursor/hooks/vouch-launch.mjs"], "string");
  t.assert.equal(typeof files[".cursor/registry/installation.json"], "string");
});
