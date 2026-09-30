import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { assertGolden } from "../helpers/golden.mjs";
import { readJson, validator } from "../helpers/registry.mjs";
import { frontmatter } from "../helpers/skills.mjs";

const stages = readJson("core/registry/stage-authoring.json");
const documents = readJson("core/registry/project-documents.json");
const diagrams = readJson("core/registry/diagrams.json");
const languages = readJson("core/registry/workflow.json").languages;
/** @type {{stage:string,name:string,sections:string[]}[]} */
const artifacts = [
  { stage: "design", key: "design_sections" },
  { stage: "build", key: "build_sections" },
  { stage: "verify", key: "review_sections" },
].map(({ stage, key }) => ({
  stage,
  name: documents.artifacts[stage].replace(/\.md$/, ""),
  sections: stages[key],
}));

/** @param {string} language @param {string} name */
function template(language, name) {
  return readFileSync(`core/templates/${language}/${name}.md`, "utf8");
}
/** @param {string} text @returns {string[]} */
const sectionIds = (text) =>
  [...text.matchAll(/<!-- sec:([a-z-]+) -->/g)].map((m) => m[1] ?? "");
/** The text of one section up to the next section marker. @param {string} text @param {string} id */
function section(text, id) {
  const parts = text.split(`<!-- sec:${id} -->`);
  return parts.length === 2
    ? ((parts[1] ?? "").split("<!-- sec:")[0] ?? "")
    : "";
}
/** @param {string} text */
function diagramBlocks(text) {
  return [
    ...text.matchAll(
      /<!-- diagram:([a-z-]+) when:([a-z-]+) -->([\s\S]*?)(?=<!-- (?:diagram|sec):|$(?![\s\S]))/g,
    ),
  ].map((m) => ({ id: m[1] ?? "", when: m[2] ?? "", body: m[3] ?? "" }));
}
/** @param {string} body */
const mermaidKind = (body) =>
  /^\s*```mermaid\s+([A-Za-z0-9-]+)\b/.exec(body)?.[1] ?? null;
/** @param {string} body */
const fence = (body) => /```mermaid\n([\s\S]*?)```/.exec(body)?.[1] ?? "";

test("stage templates share canonical section IDs in both languages", (t) => {
  t.plan(languages.length * artifacts.length);
  for (const language of languages)
    for (const { name, sections } of artifacts)
      t.assert.deepEqual(
        sectionIds(template(language, name)),
        sections,
        `DOC-4: ${language}/${name}`,
      );
});

test("a new design is a draft while the build log and Brief carry no status", (t) => {
  t.plan(languages.length * 3);
  for (const language of languages) {
    t.assert.equal(
      validator("intent-draft-frontmatter")(
        frontmatter(template(language, "design")),
      ),
      true,
      "R-PROJECT-1",
    );
    for (const name of ["build-log", "review"])
      t.assert.equal(
        template(language, name).startsWith("---"),
        false,
        `${language}/${name}: state comes from audit, Git and the PR`,
      );
  }
});

test("stage templates place registry diagrams in order with their kinds and counts", (t) => {
  /** @type {Record<string,{id:string,kind:string,when:string,count:number}[]>} */
  const registry = diagrams.artifacts;
  t.plan(languages.length * 2);
  for (const language of languages)
    for (const name of ["design", "review"]) {
      const entries = registry[name] ?? [];
      const blocks = diagramBlocks(template(language, name));
      const expected = entries.flatMap((entry) =>
        diagrams.mermaid.includes(entry.kind)
          ? Array.from({ length: entry.count }, () => ({
              id: entry.id,
              when: entry.when,
              kind: entry.kind,
            }))
          : [{ id: entry.id, when: entry.when, kind: entry.kind }],
      );
      const actual = blocks.map(({ id, when, body }) => {
        const entry = entries.find((e) => e.id === id);
        const kind = mermaidKind(body);
        if (kind) return { id, when, kind };
        if (entry?.kind === "screenshot")
          return {
            id,
            when,
            kind:
              (body.match(/shot:/g) ?? []).length === entry.count
                ? "screenshot"
                : "screenshot-count",
          };
        if (entry?.kind === "design-reference")
          return {
            id,
            when,
            kind: body.includes("design.md#")
              ? "design-reference"
              : "missing-reference",
          };
        return { id, when, kind: "unknown" };
      });
      t.assert.deepEqual(actual, expected, `DOC-7: ${language}/${name}`);
    }
});

test("diff diagrams carry the three fixed classDef colours and templates use no other colours", (t) => {
  const classDefs = Object.values(diagrams.diff).map(
    (/** @type {{classDef:string}} */ d) => d.classDef,
  );
  const allowed = new Set(
    classDefs.flatMap((line) => line.match(/#[0-9A-Fa-f]{6}\b/g) ?? []),
  );
  const files = readdirSync("core/templates", {
    recursive: true,
    withFileTypes: true,
  })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => `${e.parentPath}/${e.name}`);
  const diffBlocks = languages.flatMap((/** @type {string} */ language) =>
    ["design", "review"].flatMap((name) =>
      diagramBlocks(template(language, name))
        .filter(({ body }) =>
          stages.diff_kinds.includes(mermaidKind(body) ?? ""),
        )
        .map((block) => ({ ...block, language, name })),
    ),
  );
  t.plan(1 + diffBlocks.length + files.length);
  t.assert.equal(diffBlocks.length >= languages.length * 3, true);
  for (const { id, body, language, name } of diffBlocks) {
    const lines = fence(body)
      .split("\n")
      .map((line) => line.trim());
    t.assert.equal(
      classDefs.every((line) => lines.includes(line)),
      true,
      `Decision §18 Q4: ${language}/${name} ${id}`,
    );
  }
  for (const file of files)
    t.assert.equal(
      (readFileSync(file, "utf8").match(/#[0-9A-Fa-f]{6}\b/g) ?? []).every(
        (hex) => allowed.has(hex),
      ),
      true,
      `Decision §14: fixed colours in ${file}`,
    );
});

test("the Brief marks deferred questions, applied defaults and unresolved findings in their sections", (t) => {
  t.plan(languages.length * 4);
  for (const language of languages) {
    const text = template(language, "review");
    for (const [role, id] of Object.entries(stages.brief)) {
      const marker = `<!-- brief:${role} -->`;
      t.assert.equal(
        section(text, /** @type {string} */ (id)).includes(marker) &&
          text.split(marker).length === 2,
        true,
        `Decision §14: ${language} ${role}`,
      );
    }
    t.assert.match(
      section(text, stages.brief.defaults),
      /Q-n/,
      "Decision §18: unanswered defaults are listed in §7",
    );
  }
});

test("evidence formats and hunk categories appear where claims and reading guides are written", (t) => {
  t.plan(languages.length * 3);
  for (const language of languages) {
    const review = template(language, "review");
    const log = template(language, "build-log");
    const prefixes = (/** @type {string} */ text) =>
      stages.evidence.every((/** @type {string} */ p) =>
        text.includes(`${p}:`),
      );
    t.assert.equal(prefixes(section(review, "claims")), true, "Decision §7");
    t.assert.equal(prefixes(section(log, "verification")), true, "§7");
    t.assert.equal(
      stages.hunks.every((/** @type {string} */ h) =>
        section(review, "reading-guide").includes(`\`${h}\``),
      ),
      true,
      "Decision §14 §5",
    );
  }
});

test("stage templates match their complete rendering goldens", async (t) => {
  t.plan(languages.length * artifacts.length);
  for (const language of languages)
    for (const { name } of artifacts)
      await assertGolden(t, `${name}-${language}.md`, template(language, name));
});

test("stage Skills are on-demand, user-invocable and name their canonical inputs", (t) => {
  const agents = { build: "vouch-builder", verify: "vouch-reviewer" };
  t.plan(artifacts.length * 6 + 2);
  for (const { stage, name } of artifacts) {
    const skill = stages.skills[stage];
    const text = readFileSync(`core/skills/${skill}/SKILL.md`, "utf8");
    const metadata = frontmatter(text);
    t.assert.equal(metadata.name, skill, "DOC-1");
    t.assert.equal(metadata.reads, "on-demand", "DOC-1");
    t.assert.equal(metadata["user-invocable"], true, "DOC-1");
    t.assert.equal(
      languages.every((/** @type {string} */ language) =>
        text.includes(`{{HARNESS_DIR}}/templates/${language}/${name}.md`),
      ),
      true,
      `${skill}: bilingual templates`,
    );
    t.assert.equal(
      text.includes("{{HARNESS_DIR}}/registry/stage-authoring.json") &&
        text.includes("{{HARNESS_DIR}}/registry/quality-layers.json"),
      true,
      `STR-5: ${skill}`,
    );
    t.assert.equal(
      text.includes("../vouch/references/doctor.md"),
      true,
      `R-PROJECT-7: ${skill}`,
    );
  }
  for (const [stage, agent] of Object.entries(agents))
    t.assert.equal(
      readFileSync(
        `core/skills/${stages.skills[stage]}/SKILL.md`,
        "utf8",
      ).includes(`\`${agent}\``),
      true,
      `Decision §9: ${stage} starts ${agent}`,
    );
});

test("stage Skills connect to the human confirmation, approval, DoD and review-round canon", (t) => {
  /** @param {string} stage */
  const skill = (stage) =>
    readFileSync(`core/skills/${stages.skills[stage]}/SKILL.md`, "utf8");
  t.plan(9);
  t.assert.match(skill("design"), /`vouch confirm design`/);
  t.assert.match(
    skill("build"),
    /^git merge --ff-only /m,
    "Units run one at a time so DoD records never conflict",
  );
  const build = skill("build");
  t.assert.equal(
    build.search(/^git commit /m) >= 0 &&
      build.search(
        /^git add "vouch\/intents\/<Intent>\/build-log\.md" "vouch\/intents\/<Intent>\/audit\/events\.jsonl"$/m,
      ) >= 0 &&
      build.search(/^git commit /m) < build.search(/^git merge --ff-only /m),
    true,
    "the last DoD records are committed on the Unit branch before the fast-forward",
  );
  t.assert.match(
    skill("build"),
    /承認コミットを先に作る/,
    "worktrees start from the committed approval",
  );
  t.assert.match(skill("build"), /`vouch approve <ゲート ID>`/);
  t.assert.match(
    skill("build"),
    /node "\{\{HARNESS_DIR\}\}\/hooks\/vouch-dod\.mjs"/,
  );
  t.assert.match(skill("verify"), /review_rounds/);
  t.assert.match(skill("verify"), /Corrections/, "Learn appends to rules.md");
  t.assert.equal(
    [skill("build"), skill("verify")].every((text) =>
      text.includes("{{HARNESS_DIR}}/registry/workflow.json"),
    ),
    true,
    "Decision §18 Q5: verification defaults",
  );
});

test("stage evaluation material is synthetic input rather than a model execution result", (t) => {
  const suite = readJson("tests/eval/stages/cases.json");
  const skills = Object.values(
    readJson("core/registry/stage-authoring.json").skills,
  );
  t.plan(5 + suite.cases.length * 3);
  t.assert.equal(suite.synthetic, true);
  t.assert.equal(suite.execution, "not-run");
  t.assert.deepEqual(
    suite.cases.map((/** @type {{id:string}} */ c) => c.id),
    [
      "design-high-risk",
      "build-unapproved",
      "build-approved",
      "build-default-answer",
      "verify-independent",
      "verify-round-limit",
      "learn-proposal",
    ],
  );
  t.assert.equal(
    new Set(suite.cases.map((/** @type {{id:string}} */ c) => c.id)).size,
    suite.cases.length,
  );
  t.assert.deepEqual(
    [
      ...new Set(suite.cases.map((/** @type {{skill:string}} */ c) => c.skill)),
    ].sort(),
    [...skills].sort(),
    "every stage Skill has evaluation input",
  );
  for (const c of suite.cases) {
    t.assert.equal(skills.includes(c.skill), true);
    t.assert.equal(
      typeof c.prompt === "string" &&
        c.prompt.length > 0 &&
        c.expect.length > 0 &&
        c.expect.every(
          (/** @type {unknown} */ value) =>
            typeof value === "string" && value.length > 0,
        ),
      true,
    );
    t.assert.equal(
      Object.entries(c.files).every(
        ([path, value]) =>
          !path.startsWith("/") &&
          !path.includes("..") &&
          typeof value === "string",
      ),
      true,
      "Input validation only; no Skill response or file mutation was evaluated",
    );
  }
});
