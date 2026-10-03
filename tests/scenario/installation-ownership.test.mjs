import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { distribution, installRun } from "../helpers/install.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("install/update/remove preserve unrelated settings and detect edits to owned files", async (t) => {
  const box = await sandbox(t);
  await mkdir(box.path("project"), { recursive: true });
  const existing = {
    model: "keep-my-model",
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "echo keep-my-hook" }] }],
    },
  };
  await box.write("project/.claude/settings.json", JSON.stringify(existing));
  await box.write("project/AGENTS.md", "Keep my instructions.\n");
  distribution(t, box);
  for (const command of ["install", "update"]) {
    const result = installRun(command, box, "claude", "project");
    t.assert.equal(result.status, 0, result.stdout + result.stderr);
    const settings = JSON.parse(
      await box.read("project/.claude/settings.json"),
    );
    t.assert.equal(settings.model, existing.model);
    t.assert.ok(
      settings.hooks.Stop.some(
        (item) => item.hooks[0].command === "echo keep-my-hook",
      ),
    );
  }
  const path = "project/.claude/skills/vouch/SKILL.md";
  const original = await box.read(path);
  await box.write(path, "user edited skill\n");
  const before = await box.read("project/.claude/settings.json");
  for (const command of ["update", "remove"]) {
    const result = installRun(command, box, "claude", "project");
    t.assert.equal(result.status, 2, result.stdout + result.stderr);
    t.assert.match(result.stdout, /INSTALL-CONFLICT/);
    t.assert.equal(await box.read(path), "user edited skill\n");
    t.assert.equal(await box.read("project/.claude/settings.json"), before);
  }
  await box.write(path, original);
  const removed = installRun("remove", box, "claude", "project");
  t.assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  t.assert.deepEqual(
    JSON.parse(await box.read("project/.claude/settings.json")),
    existing,
  );
  t.assert.equal(
    await box.read("project/AGENTS.md"),
    "Keep my instructions.\n",
  );
});
