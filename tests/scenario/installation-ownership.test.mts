import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { readInstallation } from "../../scripts/lib/install-plan.mjs";
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
    t.assert.equal(
      settings.hooks.Stop.some(
        (item: { hooks: { command: string }[] }) =>
          item.hooks[0]?.command === "echo keep-my-hook",
      ),
      true,
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

test("an installation record can name only the files Vouch manages for its harness", async (t) => {
  const record = (
    harness: string,
    owned: { path: string; kind: string; previous?: string | null }[],
  ) =>
    JSON.stringify({
      v: 1,
      harness,
      scope: "project",
      digest: "a".repeat(64),
      runtimeRoot: `.vouch/versions/${"a".repeat(64)}/${harness}`,
      owned: owned.map((entry) => ({
        content: "x",
        previous: null,
        ...entry,
      })),
    });
  // Design D4: the manifest of a harness decides the editable set, never the record.
  for (const [harness, owned] of [
    ["claude", [{ path: ".claude/settings.json", kind: "hooks" }]],
    ["claude", [{ path: "AGENTS.md", kind: "block" }]],
    ["claude", [{ path: "CLAUDE.md", kind: "block" }]],
    ["claude", [{ path: ".claude/skills/vouch/SKILL.md", kind: "file" }]],
    ["claude", [{ path: ".claude/agents/vouch-builder.md", kind: "file" }]],
    ["codex", [{ path: ".codex/hooks.json", kind: "hooks" }]],
    ["codex", [{ path: ".agents/skills/vouch-build/SKILL.md", kind: "file" }]],
    ["codex", [{ path: ".codex/agents/vouch-reviewer.toml", kind: "file" }]],
    ["codex", [{ path: ".codex/config.toml", kind: "block" }]],
    ["codex", [{ path: ".codex/config.toml", kind: "file" }]],
    ["cursor", [{ path: ".cursor/hooks.json", kind: "hooks" }]],
    ["cursor", [{ path: ".cursor/rules/vouch.mdc", kind: "file" }]],
  ] as const)
    t.assert.equal(
      readInstallation(record(harness, [...owned]))?.harness,
      harness,
      owned[0].path,
    );
  for (const [harness, owned] of [
    ["claude", [{ path: ".git/config", kind: "file" }]],
    ["claude", [{ path: ".git/config", kind: "block" }]],
    ["claude", [{ path: "src/app.mjs", kind: "file" }]],
    ["claude", [{ path: ".claude/skills/mine/SKILL.md", kind: "file" }]],
    ["claude", [{ path: ".claude/settings.local.json", kind: "hooks" }]],
    ["claude", [{ path: ".cursor/hooks.json", kind: "hooks" }]],
    ["claude", [{ path: "AGENTS.md", kind: "hooks" }]],
    ["claude", [{ path: ".claude/skills/../../x", kind: "file" }]],
    ["claude", [{ path: ".codex/config.toml", kind: "block" }]],
    ["codex", [{ path: ".codex/config.toml", kind: "toml" }]],
    [
      "claude",
      [{ path: ".claude/skills/vouch/SKILL.md", kind: "file", previous: "x" }],
    ],
  ] as const)
    t.assert.throws(
      () => readInstallation(record(harness, [...owned])),
      /INSTALL-STATE/,
      `${harness} ${owned[0].kind} ${owned[0].path}`,
    );
});

test("remove refuses a forged record before touching files outside the managed set", async (t) => {
  const box = await sandbox(t);
  await mkdir(box.path("project"), { recursive: true });
  await box.write("project/.git/config", "[core]\n\tbare = false\n");
  distribution(t, box);
  t.assert.equal(installRun("install", box, "cursor", "project").status, 0);
  const path = "project/.vouch/installations/cursor.json";
  const state = JSON.parse(await box.read(path));
  state.owned.push({
    path: ".git/config",
    kind: "file",
    content: "[core]\n\tbare = false\n",
    previous: "[core]\n\tfsmonitor = forged\n",
  });
  await box.write(path, JSON.stringify(state));
  const removed = installRun("remove", box, "cursor", "project");
  t.assert.equal(removed.status, 2, removed.stdout);
  t.assert.match(removed.stdout, /INSTALL-STATE/);
  t.assert.equal(
    await box.read("project/.git/config"),
    "[core]\n\tbare = false\n",
  );
});
