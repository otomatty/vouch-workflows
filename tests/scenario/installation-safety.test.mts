import { mkdir, rm, symlink } from "node:fs/promises";
import { test } from "node:test";
import { commitChanges } from "../../scripts/lib/install-files.mjs";

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
  distribution(t, box);
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
test("Codex setup preserves model, sandbox, provider and agent depth while owning only required hook settings", async (t) => {
  const box = await sandbox(t);
  await mkdir(box.path("project"));
  distribution(t, box);
  const original =
    'model = "mine"\nsandbox_mode = "read-only"\n[features] # keep\nhooks = false\n[agents]\nmax_depth = 4\n[model_providers.mine]\nname = "mine"\n';
  await box.write("project/.codex/config.toml", original);
  t.assert.equal(installRun("install", box, "codex", "project").status, 0);
  const changed = await box.read("project/.codex/config.toml");
  t.assert.match(changed, /sandbox_mode = "read-only"/);
  t.assert.match(changed, /max_depth = 4/);
  t.assert.match(changed, /hooks = true/);
  await box.write(
    "project/.codex/config.toml",
    `${changed}\n# later user comment\n`,
  );
  t.assert.equal(installRun("remove", box, "codex", "project").status, 0);
  t.assert.equal(
    await box.read("project/.codex/config.toml"),
    `${original}\n# later user comment\n`,
  );
  await box.write(
    "project/.codex/config.toml",
    "features = { hooks = false }\n",
  );
  const invalid = installRun("install", box, "codex", "project");
  t.assert.match(invalid.stdout, /INSTALL-CONFIG/);
  t.assert.equal(
    await box.read("project/.codex/config.toml"),
    "features = { hooks = false }\n",
  );
});
