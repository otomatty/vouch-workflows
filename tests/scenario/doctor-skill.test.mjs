import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { installDoctor } from "../helpers/doctor.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";
import { doctorCommand } from "../helpers/skills.mjs";

for (const harness of /** @type {const} */ (["claude", "codex"])) {
  test(`${harness} Skill command diagnoses its installed project and reports missing files`, async (t) => {
    const install = await installDoctor(t, harness);
    const prefix = harness === "claude" ? ".claude" : ".agents";
    const guide = await readFile(
      join(install.root, prefix, "skills/vouch/references/doctor.md"),
      "utf8",
    );
    const command = doctorCommand(guide);
    const run = () =>
      spawnSync(process.execPath, [command.entry], {
        cwd: install.root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
      });
    const before = tree(install.root);
    const healthy = run();
    t.plan(6);
    t.assert.equal(healthy.status, 0, healthy.stderr);
    t.assert.equal(JSON.parse(healthy.stdout).ok, true);
    t.assert.deepEqual(tree(install.root), before);
    await rm(join(install.directory, "registry/budgets.json"));
    const missing = tree(install.root);
    const result = run();
    t.assert.equal(result.status, 2, result.stderr);
    t.assert.equal(JSON.parse(result.stdout).ok, false);
    t.assert.deepEqual(tree(install.root), missing);
  });
}
