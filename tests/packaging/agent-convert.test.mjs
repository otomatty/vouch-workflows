import { test } from "node:test";
import claudeAgent from "../../harness/claude/agent-markdown.mjs";
import codexAgent, { fromToml } from "../../harness/codex/agent-toml.mjs";
import { parseAgent, renderAgent } from "../../scripts/lib/agents.mjs";

const source = [
  "---",
  "name: vouch-explorer",
  "inputs: [intent.md, repository]",
  "tools: [read, shell]",
  "disallowed: [edit, web, delegate, ask, edit-code]",
  "---",
  "",
  "# vouch-explorer",
  "",
  'Reads "quoted" C:\\paths and a tab\there.',
  "",
  "## 入力",
  "",
  "Body with 'single' quotes and ''double'' quotes.",
  "",
].join("\n");

test("agent parser returns the declared fields, summary and body and renders them back", (t) => {
  const agent = parseAgent(source);
  t.plan(6);
  t.assert.equal(agent.name, "vouch-explorer");
  t.assert.deepEqual(agent.inputs, ["intent.md", "repository"]);
  t.assert.deepEqual(agent.tools, ["read", "shell"]);
  t.assert.deepEqual(agent.disallowed, [
    "edit",
    "web",
    "delegate",
    "ask",
    "edit-code",
  ]);
  t.assert.equal(
    agent.description,
    'Reads "quoted" C:\\paths and a tab\there.',
  );
  t.assert.equal(renderAgent(agent), source);
});

test("agent parser rejects non-canonical, unknown or incomplete declarations", (t) => {
  const cases = [
    [
      "reordered keys",
      source.replace(
        "inputs: [intent.md, repository]\ntools: [read, shell]",
        "tools: [read, shell]\ninputs: [intent.md, repository]",
      ),
    ],
    [
      "duplicate key",
      source.replace(
        "tools: [read, shell]",
        "tools: [read, shell]\ntools: [read, shell]",
      ),
    ],
    [
      "block list",
      source.replace("tools: [read, shell]", "tools:\n  - read\n  - shell"),
    ],
    [
      "empty list",
      source.replace("inputs: [intent.md, repository]", "inputs: []"),
    ],
    ["duplicate item", source.replace("[read, shell]", "[read, read, shell]")],
    ["unknown tool", source.replace("[read, shell]", "[read, shell, browse]")],
    [
      "unknown input",
      source.replace("[intent.md, repository]", "[intent.md, conversation]"),
    ],
    [
      "allowed and disallowed",
      source.replace("[edit, web", "[read, edit, web"),
    ],
    [
      "tool neither allowed nor disallowed",
      source.replace("[edit, web, ", "[edit, "),
    ],
    [
      "missing summary",
      source.replace('\nReads "quoted" C:\\paths and a tab\there.\n', ""),
    ],
    [
      "title differs from name",
      source.replace("# vouch-explorer", "# explorer"),
    ],
    ["carriage return", source.replaceAll("\n", "\r\n")],
    ["control character", source.replace("Body", "Body\u0007")],
    ["missing final newline", source.slice(0, -1)],
    ["unknown name", source.replaceAll("vouch-explorer", "helper")],
  ];
  t.plan(cases.length);
  for (const [label, text] of cases)
    t.assert.throws(() => parseAgent(text ?? ""), /AGENT-FORMAT/, label);
});

test("Claude conversion maps the vocabulary to Claude tool names and keeps the body", (t) => {
  const [name, text] = claudeAgent("vouch-explorer.md", source);
  t.plan(4);
  t.assert.equal(name, "vouch-explorer.md");
  t.assert.equal(
    text,
    [
      "---",
      "name: vouch-explorer",
      `description: ${JSON.stringify(parseAgent(source).description)}`,
      "tools: Read, Grep, Glob, Bash",
      "disallowedTools: Edit, Write, WebFetch, WebSearch, Agent, AskUserQuestion",
      "---",
      "",
      source.slice(source.indexOf("# vouch-explorer")),
    ].join("\n"),
  );
  t.assert.throws(
    () => claudeAgent("vouch-explorer.txt", source),
    /AGENT-FORMAT/,
  );
  t.assert.throws(
    () => claudeAgent("vouch-builder.md", source),
    /AGENT-FORMAT/,
  );
});

test("Codex conversion escapes strings, uses a read-only sandbox without edit and inverts exactly", (t) => {
  const [name, toml] = codexAgent("vouch-explorer.md", source);
  t.plan(6);
  t.assert.equal(name, "vouch-explorer.toml");
  t.assert.match(
    toml,
    /\ndescription = "Reads \\"quoted\\" C:\\\\paths and a tab\\there\."\n/,
  );
  t.assert.match(toml, /\nsandbox_mode = "read-only"\n/);
  t.assert.equal(fromToml(toml), source);
  t.assert.throws(
    () => codexAgent("vouch-explorer.md", source.replace("Body", "Body '''")),
    /AGENT-TOML/,
  );
  t.assert.throws(
    () => codexAgent("vouch-explorer.txt", source),
    /AGENT-FORMAT/,
  );
});

test("Codex inverse rejects TOML outside the generated subset or with changed meaning", (t) => {
  const [, toml] = codexAgent("vouch-explorer.md", source);
  const cases = [
    [
      "extra key",
      toml.replace(
        'sandbox_mode = "read-only"',
        'sandbox_mode = "read-only"\nmodel = "x"',
      ),
    ],
    ["missing comment", toml.slice(toml.indexOf("\n") + 1)],
    [
      "reordered keys",
      toml.replace(/^(name = .*)\n(description = .*)$/m, "$2\n$1"),
    ],
    ["wider sandbox", toml.replace('"read-only"', '"workspace-write"')],
    ["changed description", toml.replace("Reads", "Writes")],
    [
      "changed preamble",
      toml.replace("Vouch agent contract", "Agent contract"),
    ],
    [
      "tools line",
      toml.replace("tools: read, shell", "tools: read, shell, edit"),
    ],
    ["invalid escape", toml.replace("\\\\paths", "\\qpaths")],
    ["trailing text", `${toml}# tail\n`],
  ];
  t.plan(cases.length);
  for (const [label, text] of cases)
    t.assert.throws(() => fromToml(text ?? ""), /AGENT-(?:TOML|FORMAT)/, label);
});
