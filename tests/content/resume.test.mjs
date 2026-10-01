import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import operations from "../../core/registry/operations.json" with {
  type: "json",
};
import stages from "../../core/registry/stage-authoring.json" with {
  type: "json",
};
import { readJson, validator } from "../helpers/registry.mjs";
import { frontmatter } from "../helpers/skills.mjs";

const orchestrator = "core/skills/vouch/SKILL.md";
const references = ["resume", "ask", "questions", "report", "status", "doctor"];
/** @param {string} name */
const reference = (name) =>
  readFileSync(`core/skills/vouch/references/${name}.md`, "utf8");

test("the orchestrator routes resume, ask, report and migrate to existing references", (t) => {
  const text = readFileSync(orchestrator, "utf8");
  const description = String(frontmatter(text).description);
  t.plan(references.length * 2 + 4);
  for (const name of references) {
    t.assert.equal(existsSync(`core/skills/vouch/references/${name}.md`), true);
    t.assert.equal(text.includes(`(references/${name}.md)`), true, name);
  }
  t.assert.match(description, /resume/i);
  t.assert.match(description, /\bask\b/);
  t.assert.match(description, /\breport\b/);
  t.assert.equal(text.includes("(references/migrate.md)"), true, "migrate");
});

test("ask runs read-only in a separate explorer context and leaves recording to the hook", (t) => {
  const text = reference("ask");
  t.plan(operations.ask.prefixes.length + 4);
  for (const prefix of operations.ask.prefixes)
    t.assert.equal(text.includes(`\`${prefix.trim()} `), true, prefix);
  t.assert.match(text, /`vouch-explorer`/);
  t.assert.match(text, /読み取り/);
  t.assert.match(text, /aside\.asked/);
  t.assert.match(text, /\[R-PROJECT-3\]/);
});

test("questions name the registered commands, the person's answer input and the Brief §7 default record", (t) => {
  const text = reference("questions");
  t.plan(7);
  for (const operation of operations.question.operations)
    t.assert.equal(
      text.includes(
        `node "{{HARNESS_DIR}}/hooks/vouch-question.mjs" ${operation} <Q-n>`,
      ),
      true,
      operation,
    );
  t.assert.equal(text.includes(`\`${operations.answer.prefix}<Q-n> <`), true);
  t.assert.match(text, /Brief §7/);
  t.assert.match(text, /\[R-PROJECT-6\]/);
  t.assert.match(text, /\[R-PROJECT-1\]/);
  t.assert.match(text, /question\.defaulted/);
});

test("stage Skills that write question cards point to the shared question procedure", (t) => {
  const skills = [
    "core/skills/vouch-intent/SKILL.md",
    `core/skills/${stages.skills.design}/SKILL.md`,
    `core/skills/${stages.skills.build}/SKILL.md`,
  ];
  t.plan(skills.length);
  for (const file of skills)
    t.assert.equal(
      readFileSync(file, "utf8").includes("../vouch/references/questions.md"),
      true,
      file,
    );
});

test("resume and report name their evidence and the Node-only, read-only boundaries", (t) => {
  const resume = reference("resume");
  const report = reference("report");
  t.plan(8);
  t.assert.match(resume, /\(doctor\.md\)/);
  t.assert.match(resume, /\[R-PROJECT-7\]/);
  t.assert.match(resume, /\[R-PROJECT-1\]/);
  t.assert.match(resume, /状態ファイル/);
  t.assert.equal(
    report.includes('node "{{HARNESS_DIR}}/hooks/vouch-report.mjs"'),
    true,
  );
  t.assert.match(report, /synthetic/);
  t.assert.match(report, /推定/);
  t.assert.match(report, /ダッシュボード/);
});

test("resume evaluation inputs remain synthetic and unexecuted rather than harness evidence", (t) => {
  const suite = readJson("tests/eval/resume/cases.json");
  const ids = [
    "resume-after-compact",
    "multiple-intents",
    "corrupt-artifact",
    "node-unavailable",
    "ask-readonly",
    "blocking-question",
    "answer-is-not-approval",
    "report-measured",
  ];
  const validate = validator("audit-event");
  t.plan(3 + suite.cases.length * 2);
  t.assert.equal(suite.synthetic, true);
  t.assert.equal(suite.execution, "not-run");
  t.assert.deepEqual(
    suite.cases.map((/** @type {{id:string}} */ c) => c.id),
    ids,
  );
  for (const c of suite.cases) {
    t.assert.equal(
      typeof c.prompt === "string" &&
        c.prompt.length > 0 &&
        c.expect.length > 0,
      true,
    );
    const records = Object.entries(c.files)
      .filter(([path]) => path.endsWith("events.jsonl"))
      .flatMap(([, text]) => String(text).trim().split("\n").filter(Boolean));
    const valid = records.every((line) => {
      try {
        const row = JSON.parse(line);
        return row.synthetic === true && validate(row);
      } catch {
        return false;
      }
    });
    t.assert.equal(
      valid,
      c.id !== "corrupt-artifact",
      "Data validation only; no model response has been evaluated",
    );
  }
});
