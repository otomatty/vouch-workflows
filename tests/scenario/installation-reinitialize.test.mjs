import { rm } from "node:fs/promises";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const harness of ["claude", "codex", "cursor"])
  test(`${harness}: init repairs missing local activation and preserves other configuration and owned files`, async (t) => {
    const box = await sandbox(t);
    distribution(t, box, harness);
    const installed = installRun("install", box, harness, "project");
    t.assert.equal(installed.status, 0, installed.stdout);
    const { digest } = JSON.parse(installed.stdout);
    const before = tree(box.path("project"));
    delete before["vouch/config.json"];
    await rm(box.path("project/vouch/config.json"));
    for (const config of [
      null,
      {
        intent: "existing",
        custom: "keep",
        harnesses: { other: { custom: "keep" } },
      },
    ]) {
      if (config)
        await box.write("project/vouch/config.json", JSON.stringify(config));
      const result = installRun("init", box, harness, "project", [
        "--intent",
        "restored",
      ]);
      t.assert.equal(result.status, 0, result.stdout);
      const active = JSON.parse(await box.read("project/vouch/config.json"));
      t.assert.equal(active.v, 1);
      t.assert.equal(active.intent, "restored");
      t.assert.deepEqual(active.harnesses[harness], {
        scope: "project",
        digest,
        runtimeRoot: `.vouch/versions/${digest}/${harness}`,
        registrationScope: "project",
      });
      if (config) {
        t.assert.equal(active.custom, config.custom);
        t.assert.deepEqual(active.harnesses.other, config.harnesses.other);
      }
      const doctor = installRun("doctor", box, harness, "project");
      t.assert.equal(doctor.status, 0, doctor.stdout);
      const after = tree(box.path("project"));
      delete after["vouch/config.json"];
      t.assert.deepEqual(after, before);
    }
  });
