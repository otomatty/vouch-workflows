import { rename } from "node:fs/promises";
import { test as group } from "node:test";
import { initialize } from "../../scripts/lib/install.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "local init refuses damaged owned activation without deleting or restoring other files",
  async (t) => {
    const box = await sandbox(t);
    await test(
      "install the local Cursor runtime",
      async (t) => {
        distribution(t, box, "cursor");
        t.assert.equal(
          installRun("install", box, "cursor", "project").status,
          0,
        );
      },
      t,
    );
    for (const path of [
      ".cursor/hooks.json",
      "AGENTS.md",
      ".cursor/rules/vouch.mdc",
    ])
      await test(
        `reject the missing owned ${path}`,
        async (t) => {
          const target = box.path(`project/${path}`);
          const saved = box.path("saved-activation");
          await rename(target, saved);
          try {
            const before = tree(box.path("project"));
            t.assert.throws(
              () =>
                initialize({
                  harness: "cursor",
                  scope: "project",
                  home: box.path("home"),
                  project: box.path("project"),
                  projectExplicit: true,
                  dist: box.path("dist"),
                  intent: "must-not-save",
                }),
              /INSTALL-CONFLICT/,
            );
            t.assert.deepEqual(tree(box.path("project")), before);
          } finally {
            await rename(saved, target);
          }
        },
        t,
      );
    await test(
      "intact activation still initializes and passes doctor",
      async (t) => {
        t.assert.equal(installRun("init", box, "cursor", "project").status, 0);
        t.assert.equal(
          installRun("doctor", box, "cursor", "project").status,
          0,
        );
      },
      t,
    );
  },
);
