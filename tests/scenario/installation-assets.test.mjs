import { rm } from "node:fs/promises";
import { test as group } from "node:test";
import { install } from "../../scripts/lib/install.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex", "cursor"])
  for (const scope of ["project", "user"])
    group(
      `${harness}/${scope}: incomplete activation assets are rejected before any writes`,
      async (t) => {
        const box = await sandbox(t);
        distribution(t, box, harness);
        const prefix =
          harness === "codex" ? ".agents/skills" : `.${harness}/skills`;
        const options = {
          harness,
          scope,
          home: box.path("home"),
          project: box.path("project"),
          projectExplicit: true,
          dist: box.path("dist"),
        };
        for (const [path, kind] of [
          [`${prefix}/vouch-build/SKILL.md`, "missing"],
          [`.${harness}/templates/ja/rules.md`, "empty"],
        ])
          await test(
            `${kind} ${path} is rejected by the actual installer`,
            async (t) => {
              const at = `dist/${harness}/${path}`;
              const original = await box.read(at);
              if (kind === "missing") await rm(box.path(at));
              else await box.write(at, "");
              try {
                const before = tree(box.root);
                t.assert.throws(
                  () => install(options, "install"),
                  /INSTALL-SOURCE/,
                );
                t.assert.deepEqual(tree(box.root), before);
                if (kind === "missing") {
                  const result = installRun("install", box, harness, scope);
                  t.assert.equal(
                    result.status,
                    2,
                    result.stdout + result.stderr,
                  );
                  t.assert.match(result.stdout, /INSTALL-SOURCE/);
                  t.assert.deepEqual(tree(box.root), before);
                }
              } finally {
                await box.write(at, original);
              }
            },
            t,
          );
      },
    );
