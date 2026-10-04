import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const scope of ["project", "user"])
  group(
    `${scope}: compatible Codex provider keys survive the installation lifecycle`,
    async (t) => {
      const box = await sandbox(t, { git: false });
      const path = `${scope === "project" ? "project" : "home"}/.codex/config.toml`;
      const original = '[provider]\nfeatures = "local"\nagents = 3\n';
      await test(
        "prepare existing nested keys",
        async () => {
          distribution(t, box, "codex");
          await box.write(path, original);
        },
        t,
      );
      await test(
        "install and connect without changing provider settings",
        async (t) => {
          const result = installRun("install", box, "codex", scope);
          t.assert.equal(result.status, 0, result.stdout + result.stderr);
          t.assert.equal(
            installRun("init", box, "codex", scope, ["--intent", "compatible"])
              .status,
            0,
          );
          t.assert.equal((await box.read(path)).startsWith(original), true);
        },
        t,
      );
      await test(
        "update and diagnose while retaining nested assignments",
        async (t) => {
          const result = installRun("update", box, "codex", scope);
          t.assert.equal(result.status, 0, result.stdout + result.stderr);
          const before = tree(box.root);
          const doctor = installRun("doctor", box, "codex", scope);
          t.assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
          t.assert.deepEqual(tree(box.root), before);
          t.assert.equal((await box.read(path)).startsWith(original), true);
        },
        t,
      );
      await test(
        "remove and restore exact prior configuration",
        async (t) => {
          const result = installRun("remove", box, "codex", scope);
          t.assert.equal(result.status, 0, result.stdout + result.stderr);
          t.assert.equal(await box.read(path), original);
        },
        t,
      );
    },
  );
