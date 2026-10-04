import { rm } from "node:fs/promises";
import { join } from "node:path";
import { initialize, install } from "../../scripts/lib/install.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const scope of ["project", "user"])
  test(`${scope}: reject an invalid saved Intent without changing files and allow an explicit correction`, async (t) => {
    const box = await sandbox(t);
    distribution(t, box);
    t.assert.equal(installRun("install", box, "codex", scope).status, 0);
    if (scope === "user")
      t.assert.equal(installRun("init", box, "codex", scope).status, 0);
    const config = JSON.parse(await box.read("project/vouch/config.json"));
    config.intent = scope === "project" ? "../other" : 42;
    await box.write("project/vouch/config.json", JSON.stringify(config));
    const before = tree(box.path("project"));
    const home = scope === "user" ? tree(box.path("home")) : null;
    const options = {
      harness: "codex",
      scope,
      home: box.path("home"),
      project: box.path("project"),
      projectExplicit: true,
      dist: box.path("dist"),
    };
    t.assert.throws(() => initialize(options), /INSTALL-CONFIG/);
    if (scope === "project") {
      t.assert.throws(() => install(options, "install"), /INSTALL-CONFIG/);
      t.assert.throws(() => install(options, "update"), /INSTALL-CONFIG/);
    }
    const doctor = installRun("doctor", box, "codex", scope);
    t.assert.equal(doctor.status, 2, doctor.stdout);
    t.assert.match(doctor.stdout, /INSTALL-CONFIG/);
    t.assert.deepEqual(tree(box.path("project")), before);
    if (home) t.assert.deepEqual(tree(box.path("home")), home);
    const corrected = installRun("init", box, "codex", scope, [
      "--intent",
      "corrected",
    ]);
    t.assert.equal(corrected.status, 0, corrected.stdout);
    t.assert.equal(
      JSON.parse(await box.read("project/vouch/config.json")).intent,
      "corrected",
    );
    t.assert.equal(installRun("doctor", box, "codex", scope).status, 0);
  });

for (const missing of [
  "",
  "hooks/vouch-launch.mjs",
  "hooks/lib/launch.mjs",
  "distribution/AGENTS.md",
])
  test(`project init rejects a missing runtime file (${missing || "entire runtime"}) and preserves all remaining files`, async (t) => {
    const box = await sandbox(t);
    distribution(t, box);
    const installed = installRun("install", box, "codex", "project");
    t.assert.equal(installed.status, 0, installed.stdout);
    const { runtimeRoot } = JSON.parse(installed.stdout);
    await rm(join(runtimeRoot, missing), { recursive: true });
    const before = tree(box.path("project"));
    const initialized = installRun("init", box, "codex", "project", [
      "--intent",
      "must-not-save",
    ]);
    t.assert.equal(initialized.status, 2, initialized.stdout);
    t.assert.match(initialized.stdout, /INSTALL-(SOURCE|VERSION)/);
    t.assert.deepEqual(tree(box.path("project")), before);
    const doctor = installRun("doctor", box, "codex", "project");
    t.assert.equal(doctor.status, 2, doctor.stdout);
    t.assert.match(doctor.stdout, /INSTALL-(SOURCE|VERSION)/);
  });
