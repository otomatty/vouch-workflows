import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fromToml } from "../../harness/codex/agent-toml.mjs";
import { parseAgent } from "../../scripts/lib/agents.mjs";
import { packageRun, tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

// Claude tool names per vocabulary word, from the Claude subagent documentation.
const claude: Record<string, string[]> = {
  read: ["Read", "Grep", "Glob"],
  edit: ["Edit", "Write"],
  shell: ["Bash"],
  web: ["WebFetch", "WebSearch"],
  delegate: ["Agent"],
  ask: ["AskUserQuestion"],
};
const sources = readdirSync("core/agents")
  .sort()
  .map((file) => ({ file, text: readFileSync(`core/agents/${file}`, "utf8") }));
const installed = (text: string, harness: string) =>
  text.replaceAll("{{HARNESS_DIR}}", `.${harness}`);
const toolNames = (words: string[]) =>
  words.flatMap((word) => claude[word] ?? []).join(", ");

test("both harnesses ship every agent generated from its source", async (t) => {
  const box = await sandbox(t, { git: false });
  const result = packageRun(["--out", box.path("dist")]);
  const files = {
    claude: tree(box.path("dist/claude")),
    codex: tree(box.path("dist/codex")),
  };
  t.plan(4);
  t.assert.equal(result.status, 0, result.stderr);
  t.assert.deepEqual(
    Object.keys(files.claude).filter((name) => name.includes("/agents/")),
    sources.map(({ file }) => `.claude/agents/${file}`),
    "DIST-2: Claude agent inventory",
  );
  t.assert.deepEqual(
    Object.keys(files.codex).filter((name) => name.includes("/agents/")),
    sources.map(
      ({ file }) => `.codex/agents/${file.replace(/\.md$/, ".toml")}`,
    ),
    "DIST-2: Codex agent inventory",
  );
  t.assert.equal(packageRun(["--out", box.path("dist"), "--check"]).status, 0);
});

test("Claude agents map allowed and disallowed tools and isolate only the builder", async (t) => {
  const box = await sandbox(t, { git: false });
  const result = packageRun(["--out", box.path("dist")]);
  t.plan(1 + sources.length);
  t.assert.equal(result.status, 0, result.stderr);
  for (const { file, text } of sources) {
    const agent = parseAgent(text);
    const expected = [
      "---",
      `name: ${agent.name}`,
      `description: ${JSON.stringify(agent.description)}`,
      `tools: ${toolNames(agent.tools)}`,
      `disallowedTools: ${toolNames(agent.disallowed)}`,
      ...(agent.name === "vouch-builder" ? ["isolation: worktree"] : []),
      "---",
    ].join("\n");
    t.assert.equal(
      await box.read(`dist/claude/.claude/agents/${file}`),
      `${expected}\n${installed(agent.body, "claude")}`,
      `DIST-4: ${file}`,
    );
  }
});

test("Codex agents carry the contract, restrict writes by sandbox and round-trip to the source", async (t) => {
  const box = await sandbox(t, { git: false });
  const result = packageRun(["--out", box.path("dist")]);
  t.plan(2 + sources.length * 2);
  t.assert.equal(result.status, 0, result.stderr);
  t.assert.match(
    await box.read("dist/codex/.codex/config.toml"),
    /\n\[agents\]\nmax_depth = 1\n/,
    "Codex stops nested agents at depth one",
  );
  for (const { file, text } of sources) {
    const agent = parseAgent(text);
    const toml = await box.read(
      `dist/codex/.codex/agents/${file.replace(/\.md$/, ".toml")}`,
    );
    t.assert.equal(
      toml,
      [
        `# Generated from core/agents/${file} by scripts/package.mjs. Edit the source, not this file.`,
        `name = ${JSON.stringify(agent.name)}`,
        `description = ${JSON.stringify(agent.description)}`,
        `sandbox_mode = "${agent.tools.includes("edit") ? "workspace-write" : "read-only"}"`,
        "developer_instructions = '''",
        "Vouch agent contract: use only the listed tools; never use a disallowed tool or operation.",
        `inputs: ${agent.inputs.join(", ")}`,
        `tools: ${agent.tools.join(", ")}`,
        `disallowed: ${agent.disallowed.join(", ")}`,
        `${installed(agent.body, "codex")}'''`,
        "",
      ].join("\n"),
      `DIST-4: ${file}`,
    );
    t.assert.equal(
      fromToml(toml),
      installed(text, "codex"),
      `DIST-4: ${file} round-trips to the source`,
    );
  }
});

test("generated agents share one body and every harness path resolves in the distribution", async (t) => {
  const box = await sandbox(t, { git: false });
  const result = packageRun(["--out", box.path("dist")]);
  const generated = sources.map(({ file }) => ({
    claude: readFileSync(
      box.path(`dist/claude/.claude/agents/${file}`),
      "utf8",
    ),
    codex: fromToml(
      readFileSync(
        box.path(`dist/codex/.codex/agents/${file.replace(/\.md$/, ".toml")}`),
        "utf8",
      ),
    ),
  }));
  const paths = generated.flatMap(({ claude: c, codex: x }) => [
    ...[...c.matchAll(/\.claude\/[a-zA-Z0-9./_-]+/g)].map((match) =>
      join(box.path("dist/claude"), match[0]),
    ),
    ...[...x.matchAll(/\.codex\/[a-zA-Z0-9./_-]+/g)].map((match) =>
      join(box.path("dist/codex"), match[0]),
    ),
  ]);
  t.plan(2 + sources.length + paths.length);
  t.assert.equal(result.status, 0, result.stderr);
  t.assert.equal(paths.length > 0, true);
  for (const { claude: c, codex: x } of generated)
    t.assert.equal(
      c
        .slice(c.indexOf("\n---\n") + 5)
        .replaceAll(".claude/", "{{HARNESS_DIR}}/"),
      parseAgent(x).body.replaceAll(".codex/", "{{HARNESS_DIR}}/"),
      "both harnesses give the model the same body",
    );
  for (const path of paths)
    t.assert.equal(existsSync(path), true, `DOC-6: ${path}`);
});
