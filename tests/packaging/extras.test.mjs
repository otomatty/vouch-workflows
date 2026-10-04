import { rm } from "node:fs/promises";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "extra files and invalid arguments stop generation before any partial repair",
  async (t) => {
    const box = await sandbox(t);
    const args = ["--out", box.path("dist")];
    /** @type {Record<string,string>} */ let changed = {};
    await test(
      "prepare an extra file and a missing managed output",
      async (t) => {
        t.assert.equal(packageRun(args).status, 0);
        await box.write("dist/extra.txt", "preserve");
        await rm(
          box.path("dist/claude/.claude/hooks/vouch-record-session-start.mjs"),
        );
        changed = tree(box.path("dist"));
      },
      t,
    );
    await test(
      "check fails without repairing any byte",
      (t) => {
        t.assert.equal(packageRun([...args, "--check"]).status, 1);
        t.assert.deepEqual(tree(box.path("dist")), changed);
      },
      t,
    );
    await test(
      "generation refuses extra files without deleting or repairing output",
      (t) => {
        t.assert.equal(
          packageRun(args).status,
          1,
          "unexpected output must not be silently deleted",
        );
        t.assert.deepEqual(tree(box.path("dist")), changed);
      },
      t,
    );
    await test(
      "unknown arguments fail before changing output",
      (t) => {
        t.assert.equal(packageRun(["--unknown", ...args]).status, 1);
        t.assert.deepEqual(tree(box.path("dist")), changed);
      },
      t,
    );
  },
);
