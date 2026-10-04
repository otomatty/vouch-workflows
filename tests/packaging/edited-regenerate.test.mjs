import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "explicit regeneration restores every byte after an output file is edited",
  async (t) => {
    const box = await sandbox(t);
    const args = ["--out", box.path("dist")];
    /** @type {Record<string,string>} */ let original = {};
    await test(
      "generate and capture the original output",
      (t) => {
        t.assert.equal(packageRun(args).status, 0);
        original = tree(box.path("dist"));
      },
      t,
    );
    await test(
      "regenerate an edited file and verify every output byte",
      async (t) => {
        await box.write("dist/claude/.claude/settings.json", "changed");
        t.assert.equal(packageRun(args).status, 0);
        t.assert.deepEqual(tree(box.path("dist")), original);
      },
      t,
    );
  },
);
