import { readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { test as group } from "node:test";
import { diagnose, initialize, install } from "../../scripts/lib/install.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex", "cursor"])
  for (const scope of ["project", "user"])
    group(
      `${harness} ${scope}: setup verifies selected root snapshots`,
      async (t) => {
        const box = await sandbox(t);
        const options = {
          harness,
          scope,
          home: box.path("home"),
          project: box.path("project"),
          projectExplicit: true,
          dist: box.path("dist"),
        };
        let runtimeRoot = "";
        let descriptor = { registration: "", configuration: "" };
        await test(
          "install and activate valid default or renamed snapshots",
          async (t) => {
            distribution(t, box, harness);
            const path = `dist/${harness}/.${harness}/registry/installation.json`;
            descriptor = JSON.parse(await box.read(path));
            if (scope === "project") {
              for (const key of /** @type {const} */ ([
                "registration",
                "configuration",
              ])) {
                if (!descriptor[key]) continue;
                const name =
                  key === "registration"
                    ? "selected-hooks.json"
                    : "selected-config.toml";
                await rename(
                  box.path(`dist/${harness}/.${harness}/${descriptor[key]}`),
                  box.path(`dist/${harness}/.${harness}/${name}`),
                );
                descriptor[key] = name;
              }
              await box.write(path, JSON.stringify(descriptor));
            }
            runtimeRoot = install(options, "install").runtimeRoot;
            if (scope === "user") initialize(options);
            t.assert.equal(diagnose(options).ok, true);
          },
          t,
        );
        const cases = [
          {
            path: descriptor.registration,
            content:
              scope === "project" ? null : "changed nonempty registration\n",
          },
        ];
        if (harness === "codex")
          cases.push({
            path: descriptor.configuration,
            content: scope === "user" ? null : "# changed configuration\n",
          });
        for (const { path, content } of cases)
          await test(
            `reject ${content === null ? "missing" : "modified"} ${path} in doctor and init`,
            async (t) => {
              const target = join(runtimeRoot, path);
              const original = await readFile(target, "utf8");
              if (content === null) await rm(target);
              else await box.write(target, content);
              try {
                const before = tree(box.root);
                const result = installRun("doctor", box, harness, scope);
                t.assert.equal(result.status, 2, result.stdout + result.stderr);
                t.assert.match(result.stdout, /INSTALL-VERSION/);
                t.assert.deepEqual(tree(box.root), before);
                t.assert.throws(() => initialize(options), /INSTALL-VERSION/);
                t.assert.deepEqual(tree(box.root), before);
              } finally {
                await box.write(target, original);
              }
            },
            t,
          );
      },
    );
