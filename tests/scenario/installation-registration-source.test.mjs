import { rm } from "node:fs/promises";
import { test as group } from "node:test";
import { install } from "../../scripts/lib/install.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex", "cursor"])
  group(
    `${harness}: invalid registration snapshots cannot create an installation`,
    async (t) => {
      const box = await sandbox(t);
      let snapshot = "";
      let original = "";
      const template = `dist/${harness}/.${harness}/registry/registration.json`;
      let originalTemplate = "";
      let baseline = /** @type {Record<string,string>} */ ({});
      await test(
        "prepare the legitimate distribution",
        async (t) => {
          distribution(t, box, harness);
          const descriptor = JSON.parse(
            await box.read(
              `dist/${harness}/.${harness}/registry/installation.json`,
            ),
          );
          snapshot = `dist/${harness}/.${harness}/${descriptor.registration}`;
          original = await box.read(snapshot);
          originalTemplate = await box.read(template);
          baseline = tree(box.root);
        },
        t,
      );
      for (const scope of ["project", "user"])
        for (const variant of [
          "empty",
          "invalid-json",
          "mismatch",
          "invalid-template",
        ])
          await test(
            `${scope}: refuse ${variant} without changing any files`,
            async (t) => {
              await box.write(
                variant === "invalid-template" ? template : snapshot,
                variant === "empty"
                  ? ""
                  : variant === "invalid-json"
                    ? "invalid JSON"
                    : "{}",
              );
              try {
                const before = tree(box.root);
                if (variant === "invalid-json") {
                  const result = installRun("install", box, harness, scope);
                  t.assert.equal(
                    result.status,
                    2,
                    result.stdout + result.stderr,
                  );
                  t.assert.match(result.stdout, /INSTALL-SOURCE/);
                } else
                  t.assert.throws(
                    () =>
                      install(
                        {
                          harness,
                          scope,
                          home: box.path("home"),
                          project: box.path("project"),
                          projectExplicit: true,
                          dist: box.path("dist"),
                        },
                        "install",
                      ),
                    /INSTALL-SOURCE/,
                  );
                t.assert.deepEqual(tree(box.root), before);
              } finally {
                await box.write(snapshot, original);
                await box.write(template, originalTemplate);
                for (const path of Object.keys(tree(box.root)))
                  if (baseline[path] === undefined) await rm(box.path(path));
              }
            },
            t,
          );
    },
  );
