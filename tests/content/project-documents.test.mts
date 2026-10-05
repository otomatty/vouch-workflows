import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertGolden } from "../helpers/golden.mjs";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { readJson, validator } from "../helpers/registry.mjs";
import { sandbox } from "../helpers/runtime.mjs";
import { frontmatter } from "../helpers/skills.mjs";

test("rules templates share canonical section IDs and validated language defaults", (t) => {
  const data = readJson("core/registry/project-documents.json");
  const workflow = readJson("core/registry/workflow.json");
  t.plan(workflow.languages.length * 3);
  for (const language of workflow.languages) {
    const text = readFileSync(`core/templates/${language}/rules.md`, "utf8");
    const metadata = frontmatter(text);
    t.assert.equal(validator("rules-frontmatter")(metadata), true);
    t.assert.deepEqual(metadata, {
      language,
      checkpoints: workflow.defaults.checkpoints,
    });
    t.assert.deepEqual(
      [...text.matchAll(/<!-- sec:([a-z-]+) -->/g)].map((m) => m[1]),
      data.rules_sections,
    );
  }
});

test("shared project guidance names all stages and registered guardrails without harness paths", (t) => {
  const text = readFileSync("core/AGENTS.md", "utf8");
  const workflow = readJson("core/registry/workflow.json");
  const data = readJson("core/registry/project-documents.json");
  t.plan(3);
  t.assert.deepEqual(
    [...text.matchAll(/<!-- stage:([a-z]+) -->/g)].map((m) => m[1]),
    workflow.stages,
  );
  t.assert.deepEqual(
    [
      ...new Set([...text.matchAll(/\[(R-PROJECT-\d+)\]/g)].map((m) => m[1])),
    ].sort(),
    [...data.policy_rules].sort(),
  );
  t.assert.doesNotMatch(text, /\.(?:claude|codex|agents)\//);
});

test("shared guidance and rules distribution preserve their canonical bytes", async (t) => {
  const box = await sandbox(t, { git: false });
  const result = packageRun(["--out", box.path("dist")]);
  const sources = [
    "AGENTS.md",
    "templates/ja/rules.md",
    "templates/en/rules.md",
  ];
  t.plan(1 + sources.length * 2);
  t.assert.equal(result.status, 0, result.stderr);
  for (const harness of ["claude", "codex"]) {
    const installed = tree(box.path(`dist/${harness}`));
    for (const name of sources) {
      const expected = readFileSync(`core/${name}`, "utf8").replaceAll(
        "{{HARNESS_DIR}}",
        `.${harness}`,
      );
      const target = name === "AGENTS.md" ? name : `.${harness}/${name}`;
      t.assert.equal(
        installed[target],
        Buffer.from(expected).toString("base64"),
        target,
      );
    }
  }
});

test("rules templates match their complete rendering goldens", async (t) => {
  t.plan(2);
  for (const language of ["ja", "en"])
    await assertGolden(
      t,
      `rules-${language}.md`,
      readFileSync(`core/templates/${language}/rules.md`, "utf8"),
    );
});
