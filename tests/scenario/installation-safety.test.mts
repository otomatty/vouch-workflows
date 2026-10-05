import { mkdir, rm, symlink } from "node:fs/promises";
import { test } from "node:test";
import { commitChanges } from "../../scripts/lib/install-files.mjs";
import { codexConfig } from "../../scripts/lib/install-toml.mjs";

test("custom user home with spaces, non-ASCII and apostrophes remains selectable without repeating the home flag to doctor", async (t) => {
  const box = await sandbox(t);
  await mkdir(box.path("project"));
  distribution(t, box);
  // Design D6: `$`, quotes and percent signs are refused (installation-selection tests).
  const home = box.path("日本語 home apostrophe'");
  const installed = installRun("install", box, "codex", "user", [
    "--home",
    home,
  ]);
  t.assert.equal(installed.status, 0, installed.stdout);
  const init = installRun("init", box, "codex", "user", ["--home", home]);
  t.assert.equal(init.status, 0, init.stdout);
  const doctor = installRun("doctor", box, "codex", "user");
  t.assert.equal(doctor.status, 0, doctor.stdout);
  t.assert.equal(
    JSON.parse(doctor.stdout).runtimeRoot,
    JSON.parse(installed.stdout).runtimeRoot,
  );
});

import { distribution, installRun } from "../helpers/install.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("setup rejects malformed settings, duplicate owned hooks, incomplete runtime and linked paths without replacing files", async (t) => {
  const box = await sandbox(t);
  await mkdir(box.path("project"));
  // This test removes a runtime file from the distribution, so it packages its own.
  distribution(t, box, { own: true });
  await box.write("project/.cursor/hooks.json", "{malformed");
  t.assert.equal(installRun("install", box, "cursor", "project").status, 2);
  t.assert.equal(await box.read("project/.cursor/hooks.json"), "{malformed");
  await rm(box.path("project/.cursor/hooks.json"));
  const source = await box.read("dist/cursor/.cursor/hooks/lib/env.mjs");
  await rm(box.path("dist/cursor/.cursor/hooks/lib/env.mjs"));
  t.assert.match(
    installRun("install", box, "cursor", "project").stdout,
    /INSTALL-SOURCE/,
  );
  await box.write("dist/cursor/.cursor/hooks/lib/env.mjs", source);
  const installed = installRun("install", box, "cursor", "project");
  t.assert.equal(installed.status, 0, installed.stdout);
  const path = "project/.cursor/hooks.json";
  const hooks = JSON.parse(await box.read(path));
  hooks.hooks.sessionStart.push(hooks.hooks.sessionStart[0]);
  await box.write(path, JSON.stringify(hooks));
  for (const command of ["doctor", "update", "remove"])
    t.assert.match(
      installRun(command, box, "cursor", "project").stdout,
      /INSTALL-CONFLICT/,
    );
  await rm(box.path(path));
  await symlink(box.path("dangling"), box.path(path), "file");
  t.assert.match(
    installRun("install", box, "cursor", "project").stdout,
    /INSTALL-LINK/,
  );
});
test("failed installation transaction restores prior bytes and never removes an unowned temporary file", async (t) => {
  const box = await sandbox(t);
  await box.write("first", "old");
  await box.write(`second.vouch-install-${process.pid}`, "unowned");
  t.assert.throws(() =>
    commitChanges([
      { path: box.path("first"), before: "old", after: "new" },
      { path: box.path("second"), before: null, after: "new" },
    ]),
  );
  t.assert.equal(await box.read("first"), "old");
  t.assert.equal(
    await box.read(`second.vouch-install-${process.pid}`),
    "unowned",
  );
});
test("Codex configuration is created, extended by a marked block, or left to the user, never rewritten", (t) => {
  const block = (body: string) =>
    `\n# vouch:codex:start\n${body}# vouch:codex:end\n`;
  const features = "[features]\nhooks = true\n";
  const agents = "[agents]\nmax_depth = 1\n";
  // Design D8: absent file -> owned file; no table anywhere -> appended block.
  t.assert.deepEqual(codexConfig(null), {
    kind: "file",
    content: `${features}\n${agents}`,
  });
  t.assert.deepEqual(
    codexConfig('model = "mine"\n[provider.x]\nname = "x"\n'),
    {
      kind: "block",
      content: block(`${features}\n${agents}`),
    },
  );
  t.assert.deepEqual(codexConfig("[agents]\nmax_depth = 4\n"), {
    kind: "block",
    content: block(features),
  });
  t.assert.deepEqual(
    codexConfig("[features] # mine\nhooks = true\n[agents]\nmax_depth = 2\n"),
    { kind: "none" },
  );
  // A table the user already defined is theirs: say what to add, change nothing.
  for (const text of [
    "[features]\nhooks = false\n",
    "[features]\nother = 1\n[agents]\nmax_depth = 1\n",
    "features = { hooks = false }\n",
    "features.hooks = false\n",
    "[features.hooks]\nx = 1\n",
    "[[agents]]\nname = 1\n",
    "[features]\nhooks = true\n[agents]\nmax_depth = 0\n",
  ])
    t.assert.throws(() => codexConfig(text), /INSTALL-CONFIG: .*add/, text);
});

test("Codex setup appends its block to an existing configuration and removal restores the bytes", async (t) => {
  const box = await sandbox(t);
  await mkdir(box.path("project"));
  distribution(t, box);
  const original =
    'model = "mine"\nsandbox_mode = "read-only"\n[model_providers.mine]\nname = "mine"\n';
  await box.write("project/.codex/config.toml", original);
  const installed = installRun("install", box, "codex", "project");
  t.assert.equal(installed.status, 0, installed.stdout);
  const changed = await box.read("project/.codex/config.toml");
  t.assert.equal(changed.startsWith(original), true);
  t.assert.match(changed, /# vouch:codex:start\n\[features\]\nhooks = true\n/);
  await box.write(
    "project/.codex/config.toml",
    `${changed}# later user comment\n`,
  );
  t.assert.equal(installRun("remove", box, "codex", "project").status, 0);
  t.assert.equal(
    await box.read("project/.codex/config.toml"),
    `${original}# later user comment\n`,
  );
  await box.write("project/.codex/config.toml", "[features]\nhooks = false\n");
  const refused = installRun("install", box, "codex", "project");
  t.assert.equal(refused.status, 2);
  t.assert.match(refused.stdout, /INSTALL-CONFIG/);
  t.assert.equal(
    await box.read("project/.codex/config.toml"),
    "[features]\nhooks = false\n",
  );
});
