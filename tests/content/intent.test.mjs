import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertGolden } from "../helpers/golden.mjs";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { readJson, validator } from "../helpers/registry.mjs";
import { sandbox } from "../helpers/runtime.mjs";
import { frontmatter } from "../helpers/skills.mjs";

/** @param {string} language @param {string} artifact */
function template(language, artifact) {
  return readFileSync(`core/templates/${language}/${artifact}.md`, "utf8");
}

test("Intent and decisions templates preserve bilingual sections and draft-only metadata", (t) => {
  const data = readJson("core/registry/intent-authoring.json");
  t.plan(6);
  for (const language of ["ja", "en"]) {
    t.assert.equal(
      validator("intent-draft-frontmatter")(
        frontmatter(template(language, "intent")),
      ),
      true,
    );
    for (const artifact of ["intent", "decisions"]) {
      const sections = [
        ...template(language, artifact).matchAll(/<!-- sec:([a-z-]+) -->/g),
      ].map((m) => m[1]);
      t.assert.deepEqual(
        sections,
        data[`${artifact}_sections`],
        `DOC-4: ${language}/${artifact}`,
      );
    }
  }
});

test("decision cards expose every registered question, option and recorded-decision field", (t) => {
  const data = readJson("core/registry/intent-authoring.json");
  t.plan(6);
  for (const language of ["ja", "en"]) {
    const text = template(language, "decisions");
    for (const field of ["question", "option", "decision"]) {
      const markers = [
        ...text.matchAll(new RegExp(`<!-- ${field}:([a-z-]+) -->`, "g")),
      ].map((m) => m[1]);
      t.assert.deepEqual(
        markers,
        data[`${field}_fields`],
        `DOC-4: ${language}/${field}`,
      );
    }
  }
});

test("Intent diagrams include the required flow and conditional brownfield impact from the registry", (t) => {
  const diagrams = readJson("core/registry/diagrams.json");
  /** @type {{id:string,when:string,kind:string,count:number}[]} */
  const entries = diagrams.artifacts.intent;
  const expected = entries.flatMap(({ id, when, kind, count }) =>
    Array.from({ length: count }, () => ({ id, when, kind })),
  );
  t.plan(3);
  t.assert.equal(
    expected.length > 0 &&
      entries.every((entry) => diagrams.mermaid.includes(entry.kind)),
    true,
  );
  for (const language of ["ja", "en"]) {
    const actual = [
      ...template(language, "intent").matchAll(
        /<!-- diagram:([a-z-]+) when:([a-z-]+) -->\s*```mermaid\s+([a-zA-Z0-9-]+)\b/g,
      ),
    ].map((m) => ({ id: m[1], when: m[2], kind: m[3] }));
    t.assert.deepEqual(actual, expected, `DOC-7: ${language}`);
  }
});

test("Intent authoring templates match their complete rendering goldens", async (t) => {
  t.plan(4);
  for (const language of ["ja", "en"])
    for (const artifact of ["intent", "decisions"])
      await assertGolden(
        t,
        `${artifact}-${language}.md`,
        template(language, artifact),
      );
});

test("Intent template distribution preserves the canonical bytes for both harnesses", async (t) => {
  const box = await sandbox(t, { git: false });
  const result = packageRun(["--out", box.path("dist")]);
  t.plan(9);
  t.assert.equal(result.status, 0, result.stderr);
  for (const harness of ["claude", "codex"]) {
    const installed = tree(box.path(`dist/${harness}`));
    for (const language of ["ja", "en"])
      for (const artifact of ["intent", "decisions"])
        t.assert.equal(
          installed[`.${harness}/templates/${language}/${artifact}.md`],
          Buffer.from(template(language, artifact)).toString("base64"),
          `STR-4: ${harness}/${language}/${artifact}`,
        );
  }
});

test("Intent stage Skill is user-invocable and loaded on demand", (t) => {
  const data = readJson("core/registry/intent-authoring.json");
  const metadata = frontmatter(
    readFileSync(`core/skills/${data.skill}/SKILL.md`, "utf8"),
  );
  t.plan(3);
  t.assert.equal(metadata.name, data.skill);
  t.assert.equal(metadata.reads, "on-demand");
  t.assert.equal(metadata["user-invocable"], true);
});
