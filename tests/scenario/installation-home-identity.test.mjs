import { existsSync } from "node:fs";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "user initialization follows filesystem identity for differently cased home paths",
  async (t) => {
    const box = await sandbox(t);
    const home = box.path("HOME");
    let originalRoot = "";
    await test(
      "install and initialize the original user runtime",
      async (t) => {
        distribution(t, box, "cursor");
        const installed = installRun("install", box, "cursor", "user");
        t.assert.equal(installed.status, 0, installed.stdout);
        originalRoot = JSON.parse(installed.stdout).runtimeRoot;
        t.assert.equal(
          JSON.parse(await box.read("home/.vouch/installations/cursor.json"))
            .runtimeRoot,
          originalRoot,
        );
        t.assert.equal(installRun("init", box, "cursor", "user").status, 0);
      },
      t,
    );
    const alias = existsSync(box.path("HOME/.vouch/installations/cursor.json"));
    await test(
      "accept a real home alias and reject an uninstalled distinct home without changing files",
      async (t) => {
        const original = tree(box.path("home"));
        const project = tree(box.path("project"));
        const initialized = installRun("init", box, "cursor", "user", [
          "--home",
          home,
        ]);
        t.assert.equal(initialized.status, alias ? 0 : 2, initialized.stdout);
        if (alias) {
          t.assert.equal(
            JSON.parse(initialized.stdout).runtimeRoot,
            originalRoot,
          );
          t.assert.equal(installRun("doctor", box, "cursor", "user").status, 0);
        } else t.assert.match(initialized.stdout, /INSTALL-MISSING/);
        t.assert.deepEqual(tree(box.path("home")), original);
        t.assert.deepEqual(tree(box.path("project")), project);
      },
      t,
    );
    await test(
      "legacy relative user records still initialize with exact runtime and file validation",
      async (t) => {
        const path = "home/.vouch/installations/cursor.json";
        const original = await box.read(path);
        const state = JSON.parse(original);
        await box.write(
          path,
          JSON.stringify({
            ...state,
            runtimeRoot: `.vouch/versions/${state.digest}/cursor`,
          }),
        );
        try {
          const before = tree(box.root);
          t.assert.equal(installRun("init", box, "cursor", "user").status, 0);
          t.assert.equal(installRun("doctor", box, "cursor", "user").status, 0);
          t.assert.deepEqual(tree(box.root), before);
        } finally {
          await box.write(path, original);
        }
      },
      t,
    );
    if (!alias)
      await test(
        "an independently installed case-sensitive home selects its own runtime",
        async (t) => {
          const original = tree(box.path("home"));
          const installed = installRun("install", box, "cursor", "user", [
            "--home",
            home,
          ]);
          t.assert.equal(installed.status, 0, installed.stdout);
          const initialized = installRun("init", box, "cursor", "user", [
            "--home",
            home,
          ]);
          t.assert.equal(initialized.status, 0, initialized.stdout);
          t.assert.equal(
            JSON.parse(initialized.stdout).runtimeRoot,
            JSON.parse(installed.stdout).runtimeRoot,
          );
          t.assert.notEqual(
            JSON.parse(initialized.stdout).runtimeRoot,
            originalRoot,
          );
          t.assert.equal(installRun("doctor", box, "cursor", "user").status, 0);
          t.assert.deepEqual(tree(box.path("home")), original);
        },
        t,
      );
  },
);
