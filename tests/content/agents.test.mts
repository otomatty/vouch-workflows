import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import documents from "../../core/registry/project-documents.json" with {
  type: "json",
};
import quality from "../../core/registry/quality-layers.json" with {
  type: "json",
};
import workflow from "../../core/registry/workflow.json" with { type: "json" };
import {
  INPUTS,
  parseAgent,
  renderAgent,
  TOOLS,
} from "../../scripts/lib/agents.mjs";
import { readJson, validator } from "../helpers/registry.mjs";

const agents = readdirSync("core/agents")
  .sort()
  .map((file) => {
    const text = readFileSync(`core/agents/${file}`, "utf8");
    return { file, text, agent: parseAgent(text) };
  });
const byName = Object.fromEntries(
  agents.map((entry) => [entry.agent.name, entry]),
);
function section(body: string, heading: string) {
  const start = body.indexOf(`\n## ${heading}\n`);
  if (start < 0) return "";
  const end = body.indexOf("\n## ", start + 1);
  return body.slice(start, end < 0 ? undefined : end);
}
const layersBy = (role: string, key: string = role) =>
  quality.layers
    .filter((layer) => layer.evidence_by.includes(key))
    .map((layer) => layer.id);

test("agent sources are exactly the workflow roles with schema-valid canonical frontmatter", (t) => {
  const validate = validator("agent-frontmatter");
  t.plan(1 + agents.length * 3);
  t.assert.deepEqual(
    agents.map(({ file }) => file),
    workflow.agents.map((role) => `vouch-${role}.md`).sort(),
    "DOC-1: one source per workflow agent and no other role",
  );
  for (const { file, text, agent } of agents) {
    const { name, inputs, tools, disallowed } = agent;
    t.assert.equal(
      validate({ name, inputs, tools, disallowed }),
      true,
      `DOC-1: ${file} ${JSON.stringify(validate.errors)}`,
    );
    t.assert.equal(`${name}.md`, file, "DOC-1: name matches the file");
    t.assert.equal(renderAgent(agent), text, "DOC-1: canonical source form");
  }
});

test("every agent splits the tool vocabulary into allowed and disallowed and forbids delegation", (t) => {
  t.plan(1 + agents.length * 2);
  t.assert.deepEqual(TOOLS, [
    "read",
    "edit",
    "shell",
    "web",
    "delegate",
    "ask",
  ]);
  for (const { file, agent } of agents) {
    t.assert.deepEqual(
      [
        ...agent.tools,
        ...agent.disallowed.filter((word) => TOOLS.includes(word)),
      ].sort(),
      [...TOOLS].sort(),
      `${file}: each tool is allowed or disallowed exactly once`,
    );
    t.assert.equal(
      ["delegate", "ask"].every((word) => agent.disallowed.includes(word)),
      true,
      `${file}: no nested agents or direct questions to the human`,
    );
  }
});

test("agent inputs and operations are registered and documented with enforcement tags", (t) => {
  const tags = new Set(
    Object.keys(readJson("core/registry/enforcement-map.json").rules),
  );
  const checks = agents.flatMap(({ agent }) => [
    ...agent.inputs,
    ...agent.disallowed.filter((word) => !TOOLS.includes(word)),
  ]);
  t.plan(1 + agents.length * 4 + checks.length);
  t.assert.deepEqual(
    [...INPUTS].sort(),
    [
      ...Object.values(documents.artifacts),
      documents.decisions,
      documents.audit,
      "vouch/rules.md",
      "vouch/knowledge/",
      "diff",
      "repository",
    ].sort(),
  );
  for (const { file, agent } of agents) {
    t.assert.equal(
      agent.inputs.every((input) => INPUTS.includes(input)),
      true,
      `${file}: inputs are artifacts, rules, knowledge, diff or code`,
    );
    for (const heading of ["入力", "成果物", "行わない操作"])
      t.assert.notEqual(
        section(agent.body, heading),
        "",
        `${file}: ${heading}`,
      );
    for (const input of agent.inputs)
      t.assert.equal(
        section(agent.body, "入力").includes(`\n- \`${input}\`：`),
        true,
        `${file}: input ${input} is described`,
      );
    for (const operation of agent.disallowed.filter(
      (word) => !TOOLS.includes(word),
    )) {
      const line = section(agent.body, "行わない操作")
        .split("\n")
        .find((text) => text.startsWith(`- \`${operation}\`：`));
      const found = [...(line ?? "").matchAll(/\[(R-[A-Z]+-\d+)\]/g)].map(
        (match) => match[1],
      );
      t.assert.equal(
        found.length > 0 && found.every((tag) => tag && tags.has(tag)),
        true,
        `REG-4: ${file} operation ${operation} has a registered rule`,
      );
    }
  }
});

test("builder works one approved Unit in its own worktree and records the DoD through the command", (t) => {
  const { agent } = byName["vouch-builder"] ?? {};
  const body = agent?.body ?? "";
  const layers = [...layersBy("builder"), ...layersBy("dod", "hook:dod")];
  t.plan(5 + layers.length);
  t.assert.equal(agent?.tools.includes("edit"), true);
  t.assert.match(body, /専用の git worktree/);
  t.assert.match(body, /`git worktree add`/);
  t.assert.match(body, /`node \{\{HARNESS_DIR\}\}\/hooks\/vouch-dod\.mjs`/);
  t.assert.match(body, /\{\{HARNESS_DIR\}\}\/registry\/quality-layers\.json/);
  for (const layer of layers)
    t.assert.equal(body.includes(layer), true, `builder names ${layer}`);
});

test("reviewer verifies in a separate context against the quality layers and sabotage counts", (t) => {
  const { agent } = byName["vouch-reviewer"] ?? {};
  const body = agent?.body ?? "";
  const layers = layersBy("reviewer");
  t.plan(8 + layers.length);
  t.assert.deepEqual(quality.sabotage, { L: 0, M: 1, H: 3 });
  t.assert.equal(
    ["diff", "build-log.md", "audit/events.jsonl"].every((input) =>
      agent?.inputs.includes(input),
    ),
    true,
    "reviewer reads the artifacts, diff and check results",
  );
  t.assert.equal(
    ["builder-context", "fix-code", "keep-sabotage", "weaken-tests"].every(
      (operation) => agent?.disallowed.includes(operation),
    ),
    true,
  );
  t.assert.match(body, /\{\{HARNESS_DIR\}\}\/registry\/quality-layers\.json/);
  t.assert.match(body, /sabotage/);
  t.assert.match(body, /dependency_audit/);
  t.assert.match(body, /R-n/);
  t.assert.doesNotMatch(
    body,
    /\d\s*(?:件|箇所|層)/,
    "STR-5: counts come from the registry, not the text",
  );
  for (const layer of layers)
    t.assert.equal(body.includes(layer), true, `reviewer judges ${layer}`);
});

test("explorer only updates the knowledge layer and may read official documents", (t) => {
  const { agent } = byName["vouch-explorer"] ?? {};
  t.plan(4);
  t.assert.equal(agent?.tools.includes("web"), true);
  t.assert.equal(agent?.disallowed.includes("edit-code"), true);
  t.assert.match(section(agent?.body ?? "", "成果物"), /`vouch\/knowledge\/`/);
  t.assert.match(
    agent?.body ?? "",
    /\{\{HARNESS_DIR\}\}\/registry\/diagrams\.json/,
  );
});

test("agent sources name no harness-specific paths or unknown tokens", (t) => {
  t.plan(agents.length * 2);
  for (const { file, text } of agents) {
    t.assert.doesNotMatch(
      text,
      /\.(?:claude|codex|agents)\//,
      `STR-3: ${file}`,
    );
    t.assert.deepEqual(
      [...text.matchAll(/\{\{[A-Z_]+\}\}/g)]
        .map((match) => match[0])
        .filter((token) => token !== "{{HARNESS_DIR}}"),
      [],
      `STR-3: ${file}`,
    );
  }
});
