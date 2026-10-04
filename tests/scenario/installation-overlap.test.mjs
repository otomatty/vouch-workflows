import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex", "cursor"]) {
  test(`${harness}: init rejects a user installation as its own project without changing files`, async (t) => {
    const box = await sandbox(t);
    distribution(t, box);
    await box.write("home/vouch/config.json", '{"intent":"existing"}\n');
    await box.write("home/vouch/rules.md", "existing rules\n");
    t.assert.equal(installRun("install", box, harness, "user").status, 0);
    const before = tree(box.path("home"));
    const projects = [box.path("home"), `${box.path("home")}/../home/.`];
    if (
      existsSync(join(box.path("HOME"), `.vouch/installations/${harness}.json`))
    )
      projects.push(box.path("HOME"));
    for (const project of projects) {
      const result = installRun("init", box, harness, "user", [
        "--project",
        project,
        "--intent",
        "changed",
      ]);
      t.assert.equal(result.status, 2, result.stdout);
      t.assert.match(result.stdout, /INSTALL-SCOPE.*--project/);
      t.assert.deepEqual(tree(box.path("home")), before);
    }
    const implicit = spawnSync(
      process.execPath,
      [
        resolve("scripts/vouch.mjs"),
        "init",
        "--harness",
        harness,
        "--home",
        box.path("home"),
        "--intent",
        "changed",
      ],
      {
        cwd: box.path("home"),
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
      },
    );
    t.assert.equal(implicit.status, 2, implicit.stdout);
    t.assert.match(implicit.stdout, /INSTALL-SCOPE/);
    t.assert.deepEqual(tree(box.path("home")), before);
    // A rejected activation must not corrupt the user installation's ownership.
    const removed = installRun("remove", box, harness, "user", [
      "--project",
      box.path("home"),
    ]);
    t.assert.equal(removed.status, 0, removed.stdout);
    t.assert.equal(
      await box.read("home/vouch/config.json"),
      '{"intent":"existing"}\n',
    );
    t.assert.equal(await box.read("home/vouch/rules.md"), "existing rules\n");
  });

  test(`${harness}: init keeps a project installation active when home names the same directory`, async (t) => {
    const box = await sandbox(t);
    distribution(t, box);
    const options = ["--home", box.path("project")];
    t.assert.equal(
      installRun("install", box, harness, "project", options).status,
      0,
    );
    const result = installRun("init", box, harness, "project", [
      ...options,
      "--intent",
      "same-root",
    ]);
    t.assert.equal(result.status, 0, result.stdout);
    const config = JSON.parse(await box.read("project/vouch/config.json"));
    t.assert.equal(config.v, 1);
    t.assert.equal(config.intent, "same-root");
    t.assert.equal(config.harnesses[harness].scope, "project");
    const doctor = installRun("doctor", box, harness, "project", options);
    t.assert.equal(doctor.status, 0, doctor.stdout);
  });
}
