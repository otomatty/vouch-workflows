import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "Codex installation rejects multiline settings without changing either scope",
  async (t) => {
    const box = await sandbox(t);
    await test(
      "prepare both existing configuration files",
      async (t) => {
        distribution(t, box, "codex");
        await box.write(
          "project/.codex/config.toml",
          "# project configuration\n",
        );
        await box.write("home/.codex/config.toml", "# user configuration\n");
      },
      t,
    );
    for (const scope of ["project", "user"])
      for (const quote of [
        '"""',
        "'''",
        "array",
        "features-table",
        "agents-table",
      ])
        await test(
          `${scope}: reject the ${quote} multiline instruction`,
          async (t) => {
            const path = `${scope === "user" ? "home" : "project"}/.codex/config.toml`;
            const original = await box.read(path);
            await box.write(
              path,
              quote.endsWith("-table")
                ? `[[${quote.slice(0, -6)}]]\ncustom = true\n`
                : quote === "array"
                  ? "[features]\nflags = [\n  [true, false],\n]\nhooks = false\n"
                  : `developer_instructions = ${quote}\n[features]\nhooks = true\n[agents]\nmax_depth = 3\n${quote}\n`,
            );
            try {
              const project = tree(box.path("project"));
              const home = tree(box.path("home"));
              const result = installRun("install", box, "codex", scope);
              t.assert.equal(result.status, 2, result.stdout + result.stderr);
              t.assert.match(result.stdout, /INSTALL-CONFIG/);
              t.assert.deepEqual(tree(box.path("project")), project);
              t.assert.deepEqual(tree(box.path("home")), home);
            } finally {
              await box.write(path, original);
            }
          },
          t,
        );
  },
);
