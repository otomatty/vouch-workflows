import { rename } from "node:fs/promises";
import { join } from "node:path";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "project init rejects missing runtime files and preserves all remaining files",
  async (t) => {
    const box = await sandbox(t);
    let runtimeRoot = "";
    await test(
      "install a runtime for the independent missing-file cases",
      async (t) => {
        distribution(t, box, "codex");
        const installed = installRun("install", box, "codex", "project");
        t.assert.equal(installed.status, 0, installed.stdout);
        runtimeRoot = JSON.parse(installed.stdout).runtimeRoot;
      },
      t,
    );
    for (const missing of [
      "",
      "hooks/vouch-launch.mjs",
      "hooks/lib/launch.mjs",
      "distribution/AGENTS.md",
    ])
      await test(
        `reject a missing ${missing || "entire runtime"}`,
        async (t) => {
          const target = join(runtimeRoot, missing);
          const saved = box.path("saved-runtime");
          await rename(target, saved);
          try {
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
          } finally {
            await rename(saved, target);
          }
        },
        t,
      );
  },
);
