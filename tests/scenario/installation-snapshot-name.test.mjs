import { mkdir } from "node:fs/promises";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "snapshot filename contracts are rejected before either installation scope changes",
  async (t) => {
    const box = await sandbox(t);
    let original = "";
    const manifest = "dist/codex/.codex/registry/installation.json";
    await test(
      "prepare a complete distribution and existing scope files",
      async (t) => {
        distribution(t, box, "codex");
        await mkdir(box.path("home"), { recursive: true });
        await box.write("project/vouch/rules.md", "existing rules\n");
        original = await box.read(manifest);
      },
      t,
    );
    for (const scope of ["project", "user"])
      for (const override of [
        { registration: "registry/runtime.json" },
        { configuration: "registry/runtime.json" },
        { registration: "Invalid.json" },
        { configuration: "invalid.json" },
      ])
        await test(
          `${scope}: reject snapshot ${JSON.stringify(override)}`,
          async (t) => {
            const name = Object.values(override)[0];
            if (name !== "registry/runtime.json")
              await box.write(
                `dist/codex/.codex/${name}`,
                "existing nonempty snapshot\n",
              );
            await box.write(
              manifest,
              JSON.stringify({ ...JSON.parse(original), ...override }),
            );
            try {
              const before = [
                tree(box.path("project")),
                tree(box.path("home")),
              ];
              const result = installRun("install", box, "codex", scope);
              t.assert.equal(result.status, 2, result.stdout + result.stderr);
              t.assert.match(result.stdout, /INSTALL-SOURCE/);
              t.assert.deepEqual(
                [tree(box.path("project")), tree(box.path("home"))],
                before,
              );
            } finally {
              await box.write(manifest, original);
            }
          },
          t,
        );
  },
);
