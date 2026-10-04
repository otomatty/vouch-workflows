import { test as group } from "node:test";
import { install } from "../../scripts/lib/install.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

/** @type {Record<string,string>} */
const unfinished = {
  "invalid-bare-scalar": "bad = hello",
  "invalid-leading-zero": "bad = 01",
  "missing-array-separator": "bad = [1 2]",
  "missing-inline-separator": "bad = { a = 1 b = 2 }",
  "missing-value-eof": "bad =",
  "missing-value-newline": "bad =\nnext = 1\n",
  "missing-value-comment": "bad = # trailing",
  "unfinished-array-eof": "x = [1, 2",
  "unfinished-inline-eof": "x = { a = 1",
  "unfinished-inline-comment": "x = { a = 1 # trailing",
  "unfinished-nested-array-eof": "x = [[1], [2]",
  "closing-array-eof-comment": "x = ] # trailing",
  "extra-closing-array-eof-comment": "x = [1]] # trailing",
  "escaped-feature-key": '[features]\n"ho\\u006fks" = false\n',
  "escaped-agent-table": '["a\\u0067ents"]\nmax_depth = 3\n',
  "feature-subtable": "[features.hooks]\ncustom = true\n",
  "agent-subtable": "[agents.max_depth]\ncustom = true\n",
  "unfinished-double":
    'name = "unfinished\n[features]\nhooks = true\n[agents]\nmax_depth = 3\n',
  "unfinished-single":
    "name = 'unfinished\n[features]\nhooks = true\n[agents]\nmax_depth = 3\n",
  "escaped-newline":
    'name = "unfinished\\\n[features]\nhooks = true\n[agents]\nmax_depth = 3\n',
};

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
        ...Object.keys(unfinished),
      ])
        await test(
          `${scope}: reject the ${quote} multiline instruction`,
          async (t) => {
            const path = `${scope === "user" ? "home" : "project"}/.codex/config.toml`;
            const original = await box.read(path);
            await box.write(
              path,
              unfinished[quote] ??
                (quote.endsWith("-table")
                  ? `[[${quote.slice(0, -6)}]]\ncustom = true\n`
                  : quote === "array"
                    ? "[features]\nflags = [\n  [true, false],\n]\nhooks = false\n"
                    : `developer_instructions = ${quote}\n[features]\nhooks = true\n[agents]\nmax_depth = 3\n${quote}\n`),
            );
            try {
              const project = tree(box.path("project"));
              const home = tree(box.path("home"));
              if (
                quote === '"""' ||
                quote === "unfinished-array-eof" ||
                quote === "unfinished-inline-eof" ||
                quote === "missing-value-eof" ||
                quote === "missing-array-separator" ||
                quote === "invalid-bare-scalar" ||
                quote === "closing-array-eof-comment"
              ) {
                const result = installRun("install", box, "codex", scope);
                t.assert.equal(result.status, 2, result.stdout + result.stderr);
                t.assert.match(result.stdout, /INSTALL-CONFIG/);
              } else {
                t.assert.throws(
                  () =>
                    install(
                      {
                        harness: "codex",
                        scope,
                        home: box.path("home"),
                        project: box.path("project"),
                        projectExplicit: true,
                        dist: box.path("dist"),
                      },
                      "install",
                    ),
                  /INSTALL-CONFIG/,
                );
              }
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
