import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installDoctor } from "../helpers/doctor.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";
import { doctorCommand } from "../helpers/skills.mjs";

for (const harness of ["claude", "codex"] as const) {
  test(`${harness} Skill command fails without Node on PATH and leaves the installation unchanged`, async (t) => {
    const install = await installDoctor(t, harness);
    const prefix = harness === "claude" ? ".claude" : ".agents";
    const guide = await readFile(
      join(install.root, prefix, "skills/vouch/references/doctor.md"),
      "utf8",
    );
    const command = doctorCommand(guide);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== "path",
      ),
    );
    env.PATH = "";
    const shell =
      process.platform === "win32"
        ? (process.env.ComSpec ?? "C:/Windows/System32/cmd.exe")
        : "/bin/sh";
    const args =
      process.platform === "win32"
        ? ["/d", "/c", command.command]
        : ["-c", command.command];
    const before = tree(install.root);
    const result = spawnSync(shell, args, {
      cwd: install.root,
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    });
    t.plan(5);
    t.assert.equal(result.error, undefined);
    t.assert.notEqual(result.status, 0);
    t.assert.equal(result.stdout, "");
    t.assert.match(result.stderr, /node/i);
    t.assert.deepEqual(tree(install.root), before);
  });
}
