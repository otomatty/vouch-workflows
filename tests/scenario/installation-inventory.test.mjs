import { mkdir, rm } from "node:fs/promises";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const scope of ["project", "user"])
  group(
    `${scope}: supplied inventory cannot hide missing mandatory runtime files`,
    async (t) => {
      const box = await sandbox(t);
      const manifest = "dist/cursor/.cursor/registry/runtime.json";
      let inventory = "";
      await test(
        "prepare a complete distribution and both existing scopes",
        async (t) => {
          distribution(t, box, "cursor");
          await mkdir(box.path("home"), { recursive: true });
          await box.write("project/vouch/rules.md", "existing rules\n");
          inventory = await box.read(manifest);
        },
        t,
      );
      for (const missing of ["hooks/vouch-launch.mjs", "hooks/lib/env.mjs"])
        await test(
          `reject an inventory that omits ${missing}`,
          async (t) => {
            const path = `dist/cursor/.cursor/${missing}`;
            const bytes = await box.read(path);
            const parsed = JSON.parse(inventory);
            parsed.files = missing.includes("vouch-launch")
              ? []
              : parsed.files.filter(
                  (/** @type {string} */ path) => path !== missing,
                );
            await box.write(manifest, JSON.stringify(parsed));
            await rm(box.path(path));
            try {
              const before = tree(box.path("project"));
              const home = tree(box.path("home"));
              const result = installRun("install", box, "cursor", scope);
              t.assert.equal(result.status, 2, result.stdout);
              t.assert.match(result.stdout, /INSTALL-SOURCE/);
              t.assert.deepEqual(tree(box.path("project")), before);
              t.assert.deepEqual(tree(box.path("home")), home);
            } finally {
              await box.write(path, bytes);
              await box.write(manifest, inventory);
            }
          },
          t,
        );
    },
  );
