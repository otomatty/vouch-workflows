import { lstat, rm, symlink } from "node:fs/promises";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "local initialization repairs activation independently of unselected user descriptors",
  async (t) => {
    const box = await sandbox(t);
    let runtimeRoot = "";
    let config = "";
    let descriptor = JSON.parse("{}");
    await test(
      "install the independent local runtime",
      async (t) => {
        distribution(t, box, "cursor");
        const installed = installRun("install", box, "cursor", "project", [
          "--intent",
          "local",
        ]);
        t.assert.equal(installed.status, 0, installed.stdout);
        runtimeRoot = JSON.parse(installed.stdout).runtimeRoot;
        config = await box.read("project/vouch/config.json");
        descriptor = JSON.parse(
          await box.read("project/.vouch/installations/cursor.json"),
        );
      },
      t,
    );
    for (const variant of [
      "malformed-json",
      "different-harness",
      "linked-home",
    ])
      await test(
        `repair local activation without reading ${variant} user state`,
        async (t) => {
          const home = `user-${variant}`;
          if (variant === "linked-home") {
            await box.write(
              "linked-target/.vouch/installations/cursor.json",
              "not JSON",
            );
            await symlink(
              box.path("linked-target"),
              box.path(home),
              "junction",
            );
          } else
            await box.write(
              `${home}/.vouch/installations/cursor.json`,
              variant === "malformed-json"
                ? "not JSON"
                : JSON.stringify({
                    ...descriptor,
                    scope: "user",
                    harness: "claude",
                  }),
            );
        await box.write("project/vouch/config.json", config);
        await rm(box.path("project/vouch/config.json"));
          const before = tree(box.root);
          const initialized = installRun("init", box, "cursor", "project", [
            "--home",
            box.path(home),
            "--intent",
            "local",
          ]);
          t.assert.equal(initialized.status, 0, initialized.stdout);
          t.assert.equal(JSON.parse(initialized.stdout).scope, "project");
          t.assert.equal(
            JSON.parse(initialized.stdout).runtimeRoot,
            runtimeRoot,
          );
          t.assert.equal(await box.read("project/vouch/config.json"), config);
          const after = tree(box.root);
          delete after["project/vouch/config.json"];
          t.assert.deepEqual(after, before);
          if (variant === "linked-home")
            t.assert.equal(
              (await lstat(box.path(home))).isSymbolicLink(),
              true,
            );
          const doctor = installRun("doctor", box, "cursor", "project", [
            "--home",
            box.path(home),
          ]);
          t.assert.equal(doctor.status, 0, doctor.stdout);
          t.assert.equal(await box.read("project/vouch/config.json"), config);
        },
        t,
      );
  },
);
