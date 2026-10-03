import fs from "node:fs";
import { mkdir, rm, symlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { commitChanges } from "../../scripts/lib/install-files.mjs";
import { plan } from "../../scripts/lib/install-plan.mjs";

test("custom user home with shell metacharacters remains selectable without repeating the home flag to doctor", async (t) => {
  const box = await sandbox(t);
  await mkdir(box.path("project"));
  distribution(t, box);
  const home = box.path("日本語 home $ apostrophe'");
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

test("setup rejects malformed settings, duplicate owned hooks and incomplete runtime without replacing files", async (t) => {
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
});
test("setup refuses a linked registration without replacing it", async (t) => {
  const box = await sandbox(t);
  distribution(t, box);
  await mkdir(box.path("project/.cursor"), { recursive: true });
  try {
    await symlink(
      box.path("dangling"),
      box.path("project/.cursor/hooks.json"),
      "file",
    );
  } catch (error) {
    if (
      process.platform === "win32" &&
      /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM"
    ) {
      t.skip("Windows does not permit symbolic links for this user");
      return;
    }
    throw error;
  }
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
test("unchanged installation files are validated without replacement or temporary writes", async (t) => {
  const box = await sandbox(t);
  await box.write("same", "immutable");
  await box.write(`same.vouch-install-${process.pid}`, "unowned");
  commitChanges([
    { path: box.path("same"), before: "immutable", after: "immutable" },
  ]);
  t.assert.equal(await box.read("same"), "immutable");
  t.assert.equal(
    await box.read(`same.vouch-install-${process.pid}`),
    "unowned",
  );
  await box.write("same", "concurrent edit");
  t.assert.throws(
    () =>
      commitChanges([
        { path: box.path("same"), before: "immutable", after: "immutable" },
      ]),
    /INSTALL-CONFLICT/,
  );
  t.assert.equal(await box.read("same"), "concurrent edit");
});
test("a concurrent edit between reading and planning remains a conflict with the original bytes", async (t) => {
  const box = await sandbox(t);
  await box.write("existing", "original bytes");
  const changes = plan(box.root, null);
  t.assert.equal(changes.current("existing"), "original bytes");
  await box.write("existing", "concurrent edit");
  changes.put("existing", "installation bytes");
  t.assert.throws(
    () => commitChanges([...changes.changes.values()]),
    /INSTALL-CONFLICT/,
  );
  t.assert.equal(await box.read("existing"), "concurrent edit");
});
test("rollback attempts remaining files after a restoration fails and reports both failures", async (t) => {
  const box = await sandbox(t);
  await box.write("first", "old first");
  await box.write("second", "old second");
  await box.write(`third.vouch-install-${process.pid}`, "unowned");
  const original = fs.renameSync;
  let secondWrites = 0;
  const mocked = t.mock.method(
    fs,
    "renameSync",
    (
      /** @type {import('node:fs').PathLike} */ source,
      /** @type {import('node:fs').PathLike} */ target,
    ) => {
      if (target === box.path("second") && ++secondWrites === 2)
        throw new Error("restoration denied");
      return original(source, target);
    },
  );
  syncBuiltinESMExports();
  try {
    t.assert.throws(
      () =>
        commitChanges([
          { path: box.path("first"), before: "old first", after: "new first" },
          {
            path: box.path("second"),
            before: "old second",
            after: "new second",
          },
          { path: box.path("third"), before: null, after: "new third" },
        ]),
      (error) => {
        t.assert.equal(error instanceof AggregateError, true);
        t.assert.match(String(error), /INSTALL-ROLLBACK/);
        t.assert.equal(String(error).includes(box.path("second")), true);
        t.assert.match(String(error), /EEXIST/);
        t.assert.match(String(error), /restoration denied/);
        return true;
      },
    );
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
  t.assert.equal(await box.read("first"), "old first");
  t.assert.equal(await box.read("second"), "new second");
  t.assert.equal(
    await box.read(`third.vouch-install-${process.pid}`),
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
