import { spawnSync } from "node:child_process";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "user runtime references retain the platform meaning of a backslash",
  async (t) => {
    const box = await sandbox(t);
    const home = box.path("home\\name");
    const extra = ["--home", home];
    await test(
      "install and connect the actual user runtime",
      (t) => {
        distribution(t, box, "cursor");
        const installed = installRun("install", box, "cursor", "user", extra);
        t.assert.equal(installed.status, 0, installed.stdout);
        const initialized = installRun("init", box, "cursor", "user", extra);
        t.assert.equal(initialized.status, 0, initialized.stdout);
      },
      t,
    );
    await test(
      "execute the documented manual doctor argument and preserve files",
      async (t) => {
        const skill = await box.read("project/.cursor/skills/vouch/SKILL.md");
        const entry = /node '([^']*vouch-launch\.mjs)' doctor manual/.exec(
          skill,
        )?.[1];
        t.assert.equal(typeof entry, "string", skill);
        const guidance = await box.read("project/AGENTS.md");
        if (process.platform !== "win32")
          t.assert.match(guidance, /home%5Cname/);
        const before = tree(box.root);
        const result = spawnSync(
          process.execPath,
          [entry ?? "", "doctor", "manual"],
          {
            cwd: box.path("project"),
            env: { ...process.env, VOUCH_PROJECT_ROOT: box.path("project") },
            encoding: "utf8",
            windowsHide: true,
            timeout: 4000,
          },
        );
        t.assert.equal(result.status, 0, result.stdout + result.stderr);
        t.assert.equal(JSON.parse(result.stdout).ok, true, result.stdout);
        t.assert.deepEqual(tree(box.root), before);
      },
      t,
    );
  },
);
