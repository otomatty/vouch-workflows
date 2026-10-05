import { createHash } from "node:crypto";
import { test } from "node:test";
import { snapshotIntent } from "../../../core/hooks/lib/approval.mjs";
import {
  checkpointContent,
  describeTarget,
  missingCheckpoints,
  readCheckpointMode,
  readPlan,
  requiredCheckpoints,
  tableRows,
} from "../../../core/hooks/lib/checkpoints.mjs";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import { confirmation } from "../../helpers/approval.mjs";
import { designed, planned } from "../../helpers/intent-review.mjs";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const section = (text: string, id: string) => {
  const start = text.indexOf(`<!-- sec:${id} -->\n`);
  const end = text.indexOf("<!-- sec:", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
};
const mixed = [
  ["U1", "L: wording", "not-required: none"],
  ["U-2.b", "M — internal", "required — contract diagram"],
];

test("plans read Unit IDs, risk and design identifiers from the first plan table", (t) => {
  const high = [...mixed, ["U3", "H, public API", "required"]];
  t.plan(6);
  t.assert.deepEqual(readPlan(planned()), {
    plan: {
      units: [{ id: "U1", risk: "L", design: false }],
      risk: "L",
      design: false,
    },
  });
  t.assert.deepEqual(readPlan(planned(mixed)), {
    plan: {
      units: [
        { id: "U1", risk: "L", design: false },
        { id: "U-2.b", risk: "M", design: true },
      ],
      risk: "M",
      design: true,
    },
  });
  t.assert.deepEqual(readPlan(planned(high)), {
    plan: {
      units: [
        { id: "U1", risk: "L", design: false },
        { id: "U-2.b", risk: "M", design: true },
        { id: "U3", risk: "H", design: true },
      ],
      risk: "H",
      design: true,
    },
  });
  t.assert.deepEqual(
    readPlan(planned().replaceAll("\n", "\r\n")),
    readPlan(planned()),
  );
  const later = planned().replace(
    "<!-- sec:verification -->",
    "| Extra | table | ignored | x | y |\n\n<!-- sec:verification -->",
  );
  t.assert.deepEqual(readPlan(later), readPlan(planned()));
  t.assert.deepEqual(
    readPlan(
      "---\nstatus: draft\n---\n<!-- sec:plan -->\n| Unit | a | b | c | d |\n| --- | --- | --- | --- | --- |\n| U1 | a | b | L | not-required |",
    ),
    readPlan(planned()),
  );
});

test("compact or aligned separators, indentation and trailing spaces read the same plan", (t) => {
  const plan = planned();
  t.plan(4);
  t.assert.deepEqual(
    readPlan(
      plan.replace(
        "| --- | --- | --- | --- | --- |",
        "|---|:---:|---|---:|:---|",
      ),
    ),
    readPlan(plan),
  );
  t.assert.deepEqual(
    readPlan(
      plan
        .replace("## Plan\n", "## Plan\nColumns: Unit | Risk |\n")
        .replace(/(\| U1 .*\n)/, "$1Prose after the table |\n"),
    ),
    readPlan(plan),
  );
  t.assert.deepEqual(readPlan(plan.replace(/^\|/gm, "  |")), readPlan(plan));
  t.assert.deepEqual(readPlan(plan.replace(/\|\n/g, "|   \n")), readPlan(plan));
});

test("plan errors name the row and the identifier that is wrong", (t) => {
  const error = (rows: string[][]) =>
    (readPlan(planned(rows)) as { error: string }).error;
  t.plan(5);
  t.assert.equal(
    (readPlan("") as { error: string }).error,
    "a plan table with Unit rows is required",
  );
  t.assert.equal(
    error([["", "L", "not-required"]]),
    "row: a unique Unit ID is required",
  );
  t.assert.equal(
    error([["U 1", "L", "not-required"]]),
    "U 1: a unique Unit ID is required",
  );
  t.assert.equal(
    error([["U1", "Low", "not-required"]]),
    "U1: risk must start with L, M or H",
  );
  t.assert.equal(
    error([["U1", "L", "maybe"]]),
    "U1: design must start with required or not-required",
  );
});

test("an H Unit requires Design even when every row declares none", (t) => {
  t.plan(2);
  const result = readPlan(planned([["U1", "H: schema", "required: contract"]]));
  t.assert.equal("plan" in result && result.plan.design, true);
  t.assert.match(
    (
      readPlan(planned([["U1", "H: schema", "not-required: none"]])) as {
        error: string;
      }
    ).error,
    /U1/,
  );
});

test("placeholder, ambiguous and malformed plans are errors, never defaults", (t) => {
  const plan = planned();
  const cases = [
    plan.replace("<!-- sec:plan -->", "<!-- plan -->"),
    plan.replace("<!-- sec:scope -->", "<!-- sec:plan -->"),
    plan.replace(/\| Unit[\s\S]*?\n\n/, "No table.\n\n"),
    plan.replace("| --- | --- | --- | --- | --- |\n", ""),
    plan.replace(/\| U1 .*\n/, ""),
    planned([["未記入", "未評価", "未確定"]]),
    planned([["Unfilled", "Unassessed", "Undecided"]]),
    planned([["U 1", "L", "not-required"]]),
    planned([["-U1", "L", "not-required"]]),
    planned([["U1", "Low", "not-required"]]),
    planned([["U1", "Hard", "required"]]),
    planned([["U1", "L", "requiredness"]]),
    planned([["U1", "L", "not required"]]),
    planned([["U1", "L", "optional"]]),
    planned([
      ["U1", "L", "not-required"],
      ["U1", "M", "required"],
    ]),
    plan.replace(/\| U1 .*\n/, "| U1 | AC-1 | src | L |\n"),
    plan.replace(/\| U1 .*\n/, "| U1 | AC-1 |\n"),
    plan.replace(/\| U1 .*\n/, "|  | AC-1 | src | L | not-required |\n"),
    plan.replace(/\| --- .*\n\| U1 .*\n/, ""),
    "",
    plan.replace(
      "| --- | --- | --- | --- | --- |\n",
      "| U0 | AC-1 | src | L | not-required |\n",
    ),
    plan.replace(
      "| --- | --- | --- | --- | --- |",
      "| --- | --- | --- | --- | --- | extra",
    ),
    plan.replace(
      "| --- | --- | --- | --- | --- |",
      "x| --- | --- | --- | --- | --- |",
    ),
    `${plan.replace(/\| U1 .*\n/, "")}`.replace(
      "| --- | --- | --- | --- | --- |",
      "| --- | --- | --- | --- | --- |\nnot a row",
    ),
  ];
  t.plan(cases.length);
  for (const text of cases)
    t.assert.equal("error" in readPlan(text), true, text.slice(0, 400));
});

test("checkpoint modes come from rules.md frontmatter or the workflow default", (t) => {
  const rules = (body: string) => `---\nlanguage: ja\n${body}\n---\n# Rules\n`;
  const cases = [
    [null, "topic"],
    [rules("checkpoints: topic"), "topic"],
    [rules("checkpoints: unit"), "unit"],
    [rules("checkpoints: section").replaceAll("\n", "\r\n"), "section"],
    [rules("checkpoints:  section "), "section"],
    ["", null],
    ["# Rules\n\ncheckpoints: unit\n", null],
    [rules("language: en"), null],
    [rules("checkpoints: page"), null],
    [rules("checkpoints: unit\ncheckpoints: topic"), null],
    [rules("checkpoints: Topic"), null],
    ["---\ncheckpoints: unit\n", null],
    [rules("old_checkpoints: unit"), null],
    [rules("checkpoints: unit extra"), null],
    [rules("checkpoints: topic\ncheckpoints:"), null],
    [rules("checkpoints:\ncheckpoints: unit"), null],
    [rules("checkpoints : unit"), null],
    [rules("checkpoints: unit\nold_checkpoints: topic"), "unit"],
    [rules("checkpoints: topic\ncheckpointsX: unit"), "topic"],
    [`${rules("language: en")}checkpoints: unit\n`, null],
    [`﻿${rules("checkpoints: unit")}`, null],
  ];
  t.plan(cases.length);
  for (const [text, mode] of cases)
    t.assert.equal(
      readCheckpointMode(text as string | null),
      mode,
      JSON.stringify(text),
    );
});

test("required checkpoints follow the mode, the Design condition and H Unit additions", (t) => {
  const plan = (text: string) => {
    const result = readPlan(text);
    if (!("plan" in result)) throw new Error(result.error);
    return result.plan;
  };
  const low = plan(planned());
  const design = plan(planned(mixed));
  const high = plan(
    planned([
      ["U1", "L", "not-required"],
      ["U2", "H", "required"],
    ]),
  );
  const topic = [
    { checkpoint: "acceptance" },
    { checkpoint: "scope" },
    { checkpoint: "units" },
  ];
  const sections = [
    "summary",
    "acceptance",
    "scope",
    "analysis",
    "plan",
    "verification",
    "diagrams",
    "checkpoints",
    "references",
  ].map((id) => ({ checkpoint: "section", section: id }));
  const units = (...ids: string[]) =>
    ids.map((id) => ({ checkpoint: "unit", unit: id }));
  // Open questions Q2 B and C: design.md is confirmed per Design Unit or per design section.
  const designSections = [
    "summary",
    "ideal",
    "alternatives",
    "diagrams",
    "contract",
    "threats",
    "units",
    "references",
  ].map((id) => ({ checkpoint: "design", section: id }));
  t.plan(8);
  t.assert.deepEqual(requiredCheckpoints("topic", low), topic);
  t.assert.deepEqual(requiredCheckpoints("topic", design), [
    ...topic,
    { checkpoint: "design" },
  ]);
  t.assert.deepEqual(requiredCheckpoints("topic", high), [
    ...topic,
    ...units("U1", "U2"),
    { checkpoint: "design" },
  ]);
  t.assert.deepEqual(requiredCheckpoints("unit", design), [
    { checkpoint: "acceptance" },
    ...units("U1", "U-2.b"),
    { checkpoint: "design", unit: "U-2.b" },
  ]);
  t.assert.deepEqual(requiredCheckpoints("unit", high), [
    { checkpoint: "acceptance" },
    ...units("U1", "U2"),
    { checkpoint: "design", unit: "U2" },
  ]);
  t.assert.deepEqual(requiredCheckpoints("section", low), sections);
  t.assert.deepEqual(requiredCheckpoints("section", design), [
    ...sections,
    ...designSections,
  ]);
  t.assert.deepEqual(requiredCheckpoints("section", high), [
    ...sections,
    ...units("U1", "U2"),
    ...designSections,
  ]);
});

test("checkpoint content digests the exact confirmed section, row or normalized design", (t) => {
  const text = planned(mixed);
  const design = "---\nstatus: draft\n---\n# Design\n\nDiff diagram.\n";
  const texts = { intent: text, design };
  const intent = (part: string) => ({
    path: "intent.md",
    sha256: sha(part),
  });
  t.plan(9);
  t.assert.deepEqual(
    checkpointContent({ checkpoint: "acceptance" }, texts),
    intent(section(text, "acceptance")),
  );
  t.assert.deepEqual(
    checkpointContent({ checkpoint: "scope" }, texts),
    intent(section(text, "scope")),
  );
  t.assert.deepEqual(
    checkpointContent({ checkpoint: "units" }, texts),
    intent(section(text, "plan")),
  );
  t.assert.deepEqual(
    checkpointContent({ checkpoint: "section", section: "references" }, texts),
    intent(section(text, "references")),
  );
  t.assert.deepEqual(
    checkpointContent({ checkpoint: "unit", unit: "U-2.b" }, texts),
    intent(
      "| U-2.b | AC-1 | src | M — internal | required — contract diagram |\n",
    ),
  );
  t.assert.deepEqual(checkpointContent({ checkpoint: "design" }, texts), {
    path: "design.md",
    sha256: snapshotIntent(design)?.revision.sha256,
  });
  t.assert.deepEqual(
    checkpointContent(
      { checkpoint: "design" },
      { intent: text, design: design.replace("draft", "approved") },
    ),
    checkpointContent({ checkpoint: "design" }, texts),
  );
  const crlf = text.replaceAll("\n", "\r\n");
  t.assert.deepEqual(
    checkpointContent(
      { checkpoint: "unit", unit: "U1" },
      { intent: crlf, design },
    ),
    intent("| U1 | AC-1 | src | L: wording | not-required: none |\r\n"),
  );
  t.assert.deepEqual(
    checkpointContent({ checkpoint: "acceptance" }, { intent: crlf, design }),
    intent(
      section(crlf.replaceAll("\r\n", "\n"), "acceptance").replaceAll(
        "\n",
        "\r\n",
      ),
    ),
  );
});

test("absent, duplicated or unsupported targets have no content", (t) => {
  const text = planned();
  const texts = { intent: text, design: null };
  const cases = [
    [{ checkpoint: "section", section: "missing" }, texts],
    [
      { checkpoint: "acceptance" },
      {
        intent: `${text}<!-- sec:acceptance -->\nagain\n`,
        design: null,
      },
    ],
    [
      { checkpoint: "acceptance" },
      {
        intent: text.replace(
          "<!-- sec:acceptance -->",
          "<!-- sec:acceptance --> note",
        ),
        design: null,
      },
    ],
    [{ checkpoint: "unit", unit: "U9" }, texts],
    [
      { checkpoint: "unit", unit: "U1" },
      {
        intent: text.replace("<!-- sec:plan -->", "<!-- sec:planning -->"),
        design: null,
      },
    ],
    [
      { checkpoint: "unit", unit: "U1" },
      {
        intent: planned([
          ["U1", "L", "not-required"],
          ["U1", "L", "not-required"],
        ]),
        design: null,
      },
    ],
    [{ checkpoint: "design" }, texts],
    [{ checkpoint: "scope" }, { intent: "", design: null }],
    [{ checkpoint: "design" }, { intent: text, design: "# No frontmatter\n" }],
  ];
  t.plan(cases.length);
  for (const [target, value] of cases)
    t.assert.equal(
      checkpointContent(
        target as import("../../../core/hooks/lib/runtime-contracts.mjs").CheckpointTarget,
        value as import("../../../core/hooks/lib/runtime-contracts.mjs").ArtifactTexts,
      ),
      null,
      JSON.stringify(target),
    );
});

test("targets are described with the confirm command suffix", (t) => {
  t.plan(5);
  t.assert.equal(
    describeTarget({ checkpoint: "design", unit: "U1" }),
    "design unit U1",
  );
  t.assert.equal(
    describeTarget({ checkpoint: "design", section: "ideal" }),
    "design section ideal",
  );
  t.assert.equal(describeTarget({ checkpoint: "design" }), "design");
  t.assert.equal(describeTarget({ checkpoint: "unit", unit: "U1" }), "unit U1");
  t.assert.equal(
    describeTarget({ checkpoint: "section", section: "plan" }),
    "section plan",
  );
});

test("only derived, nonsynthetic confirmations of the current content count", (t) => {
  const intent = "260929-plan";
  const text = planned(mixed);
  const design = "---\nstatus: draft\n---\n# Design\n";
  const artifacts = { intent: text, design };
  const required: import("../../../core/hooks/lib/runtime-contracts.mjs").CheckpointTarget[] =
    [
      { checkpoint: "acceptance" },
      { checkpoint: "unit", unit: "U1" },
      { checkpoint: "section", section: "scope" },
      { checkpoint: "design" },
    ];
  const content = (
    target: import("../../../core/hooks/lib/runtime-contracts.mjs").CheckpointTarget,
  ) => {
    const value = checkpointContent(target, artifacts);
    if (!value) throw new Error("no content");
    return value;
  };
  const valid = required.map((target) =>
    confirmation(target, content(target), { intent }),
  );
  const query = (events: unknown[]) =>
    missingCheckpoints({
      required,
      events: events as never,
      intent,
      texts: artifacts,
      newId,
    });
  const [acceptance, unit, scope, designed] = valid;
  if (!acceptance || !unit || !scope || !designed) throw new Error("records");
  const { content: _content, submission: _submission, ...legacy } = acceptance;
  t.plan(14);
  t.assert.deepEqual(query(valid), []);
  t.assert.deepEqual(query([]), required);
  t.assert.deepEqual(query(valid.slice(1)), [{ checkpoint: "acceptance" }]);
  t.assert.deepEqual(
    missingCheckpoints({
      required,
      events: valid,
      intent,
      texts: { intent: text.replace("AC-1: keep", "AC-1: drop"), design },
      newId,
    }),
    [{ checkpoint: "acceptance" }],
  );
  t.assert.deepEqual(
    missingCheckpoints({
      required,
      events: valid,
      intent,
      texts: { ...artifacts, design: null },
      newId,
    }),
    [{ checkpoint: "design" }],
  );
  const replaced = (change: object) => [
    { ...acceptance, ...change },
    unit,
    scope,
    designed,
  ];
  for (const change of [
    { synthetic: true },
    { intent: "other" },
    { id: "evt_forged" },
    { session: "another-session" },
    { checkpoint: "scope" },
    { content: { ...acceptance.content, path: "design.md" } },
  ])
    t.assert.deepEqual(
      query(replaced(change)),
      [{ checkpoint: "acceptance" }],
      JSON.stringify(change),
    );
  t.assert.deepEqual(query([legacy, unit, scope, designed]), [
    { checkpoint: "acceptance" },
  ]);
  t.assert.deepEqual(
    query([
      acceptance,
      { ...unit, unit: "U-2.b" },
      { ...scope, section: "acceptance" },
      designed,
    ]),
    [
      { checkpoint: "unit", unit: "U1" },
      { checkpoint: "section", section: "scope" },
    ],
  );
  const lookalikes = [
    "question.answered",
    "question.defaulted",
    "gate.approved",
  ].map((type) => ({ ...acceptance, type }));
  t.assert.deepEqual(query([...lookalikes, unit, scope, designed]), [
    { checkpoint: "acceptance" },
  ]);
});

test("a Unit confirmation goes stale when only its row's spacing or line break changes", (t) => {
  const intent = "260929-plan";
  const text = planned();
  const target: import("../../../core/hooks/lib/runtime-contracts.mjs").CheckpointTarget =
    { checkpoint: "unit", unit: "U1" };
  const content = checkpointContent(target, { intent: text, design: null });
  if (!content) throw new Error("content");
  const events = [confirmation(target, content, { intent })];
  const missing = (current: string) =>
    missingCheckpoints({
      required: [target],
      events,
      intent,
      texts: { intent: current, design: null },
      newId,
    });
  const row = /\| U1 .*\n/;
  t.plan(4);
  t.assert.deepEqual(missing(text), []);
  t.assert.deepEqual(missing(text.replace(row, (line) => `  ${line}`)), [
    target,
  ]);
  t.assert.deepEqual(
    missing(text.replace(row, (line) => line.replace("\n", "  \n"))),
    [target],
  );
  t.assert.deepEqual(
    missing(text.replace(row, (line) => line.replace("\n", "\r\n"))),
    [target],
  );
});

test("tableRows reads the first table of a named section and defaults to the plan", (t) => {
  const text = [
    "<!-- sec:dod -->",
    "## DoD",
    "",
    "| Target | Command |",
    "| --- | --- |",
    "| Tests | `npm test \\| cat` |",
    "",
    "| Later | table |",
    "<!-- sec:plan -->",
    "",
  ].join("\n");
  t.plan(3);
  t.assert.deepEqual(
    tableRows(text, "dod")?.map((row) => row.cells),
    [["Tests", "`npm test \\| cat`"]],
  );
  t.assert.equal(tableRows(text, "restrictions"), null);
  t.assert.deepEqual(
    tableRows(planned())?.map((row) => row.cells[0]),
    ["U1"],
  );
});

test("design sections and Design Units digest their part of the normalized design.md", (t) => {
  const text = planned(mixed);
  const design = designed([
    ["U1", "Keep the parser."],
    ["U-2.b", "Split the reader."],
  ]);
  const texts = { intent: text, design };
  const own = (value: string, other: string) =>
    value.replace(new RegExp(`\\| ${other} \\|.*\\r?\\n`), "");
  const designOf = (part: string) => ({
    path: "design.md",
    sha256: sha(part),
  });
  const crlf = design.replaceAll("\n", "\r\n");
  t.plan(7);
  t.assert.deepEqual(
    checkpointContent({ checkpoint: "design", section: "ideal" }, texts),
    designOf(section(design, "ideal")),
  );
  t.assert.deepEqual(
    checkpointContent({ checkpoint: "design", section: "units" }, texts),
    designOf(section(design, "units")),
  );
  t.assert.deepEqual(
    checkpointContent({ checkpoint: "design", unit: "U-2.b" }, texts),
    designOf(own(design, "U1")),
  );
  t.assert.deepEqual(
    checkpointContent({ checkpoint: "design", unit: "U1" }, texts),
    designOf(own(design, "U-2\\.b")),
  );
  t.assert.deepEqual(
    checkpointContent(
      { checkpoint: "design", unit: "U1" },
      { intent: text, design: design.replace("draft", "approved") },
    ),
    checkpointContent({ checkpoint: "design", unit: "U1" }, texts),
  );
  t.assert.deepEqual(
    checkpointContent(
      { checkpoint: "design", unit: "U1" },
      { intent: text, design: crlf },
    ),
    designOf(own(crlf, "U-2\\.b")),
  );
  t.assert.notDeepEqual(
    checkpointContent({ checkpoint: "design", unit: "U1" }, texts),
    checkpointContent({ checkpoint: "design" }, texts),
  );
});

test("absent, duplicated or ambiguous design parts have no content", (t) => {
  const text = planned(mixed);
  const design = designed([["U1", "Keep the parser."]]);
  const cases: [object, string | null][] = [
    [{ checkpoint: "design", section: "missing" }, design],
    [{ checkpoint: "design", section: "ideal" }, null],
    [{ checkpoint: "design", unit: "U1" }, null],
    [
      { checkpoint: "design", section: "ideal" },
      design.replace("---\nstatus: draft\n---\n", ""),
    ],
    [
      { checkpoint: "design", unit: "U1" },
      design.replace("---\nstatus: draft\n---\n", ""),
    ],
    [{ checkpoint: "design", unit: "U9" }, design],
    [
      { checkpoint: "design", unit: "U1" },
      designed([
        ["U1", "Keep the parser."],
        ["U1", "Split the reader."],
      ]),
    ],
    [
      { checkpoint: "design", unit: "U1" },
      design.replace("<!-- sec:units -->", "<!-- sec:unit-designs -->"),
    ],
    [
      { checkpoint: "design", unit: "U1" },
      design.replace("| --- | --- | --- | --- | --- |\n", ""),
    ],
    [
      { checkpoint: "design", section: "ideal" },
      `${design}<!-- sec:ideal -->\nagain\n`,
    ],
    [{ checkpoint: "design", unit: "U1", section: "ideal" }, design],
  ];
  t.plan(cases.length);
  for (const [target, value] of cases)
    t.assert.equal(
      checkpointContent(
        target as import("../../../core/hooks/lib/runtime-contracts.mjs").CheckpointTarget,
        { intent: text, design: value },
      ),
      null,
      JSON.stringify(target),
    );
});

test("a design Unit confirmation goes stale with shared parts or its own row, not another Unit's row", (t) => {
  const intent = "260929-plan";
  const text = planned(mixed);
  const design = designed([
    ["U1", "Keep the parser."],
    ["U-2.b", "Split the reader."],
  ]);
  const required: import("../../../core/hooks/lib/runtime-contracts.mjs").CheckpointTarget[] =
    [
      { checkpoint: "design", unit: "U1" },
      { checkpoint: "design", unit: "U-2.b" },
      { checkpoint: "design", section: "ideal" },
    ];
  const events = required.map((target) => {
    const content = checkpointContent(target, { intent: text, design });
    if (!content) throw new Error("content");
    return confirmation(target, content, { intent });
  });
  const missing = (current: string, recorded: unknown[] = events) =>
    missingCheckpoints({
      required,
      events: recorded as never,
      intent,
      texts: { intent: text, design: current },
      newId,
    });
  const [first, second, ideal] = required;
  const [byFirst, bySecond, byIdeal] = events;
  if (!byFirst || !bySecond || !byIdeal) throw new Error("records");
  const whole = checkpointContent(
    { checkpoint: "design" },
    { intent: text, design },
  );
  if (!whole) throw new Error("whole");
  t.plan(7);
  t.assert.deepEqual(missing(design), []);
  t.assert.deepEqual(missing(design.replace("Keep the parser.", "Keep it.")), [
    first,
  ]);
  t.assert.deepEqual(missing(design.replace("Split the reader.", "Split.")), [
    second,
  ]);
  t.assert.deepEqual(
    missing(design.replace("Ideal: one parser.", "Ideal: two parsers.")),
    [first, second, ideal],
  );
  t.assert.deepEqual(
    missing(design.replace("Parser input type.", "Reader input type.")),
    [first, second],
  );
  t.assert.deepEqual(
    missing(design, [
      confirmation({ checkpoint: "design" }, whole, { intent }),
      { ...byFirst, unit: "U-2.b" },
      { ...byIdeal, section: "alternatives" },
    ]),
    required,
  );
  t.assert.deepEqual(
    missing(design, [{ ...byFirst, section: "ideal" }, bySecond, byIdeal]),
    [first],
  );
});

test("section mode covers the design.md title, intro and unregistered sections through its first section", (t) => {
  const intent = "260929-plan";
  const text = planned(mixed);
  const design = designed();
  const required: import("../../../core/hooks/lib/runtime-contracts.mjs").CheckpointTarget[] =
    [
      "summary",
      "ideal",
      "alternatives",
      "diagrams",
      "contract",
      "threats",
      "units",
      "references",
    ].map((id) => ({ checkpoint: "design", section: id }));
  const events = required.map((target) => {
    const content = checkpointContent(target, { intent: text, design });
    if (!content) throw new Error("content");
    return confirmation(target, content, { intent });
  });
  const missing = (current: string) =>
    missingCheckpoints({
      required,
      events: events as never,
      intent,
      texts: { intent: text, design: current },
      newId,
    });
  const summary: import("../../../core/hooks/lib/runtime-contracts.mjs").CheckpointTarget =
    { checkpoint: "design", section: "summary" };
  const head = design.slice(0, design.indexOf("<!-- sec:summary -->"));
  t.plan(5);
  t.assert.deepEqual(checkpointContent(summary, { intent: text, design }), {
    path: "design.md",
    sha256: sha(`${head}${section(design, "summary")}`),
  });
  t.assert.deepEqual(missing(design), []);
  t.assert.deepEqual(
    missing(design.replace("# Synthetic design", "# Another design")),
    [summary],
  );
  t.assert.deepEqual(
    missing(
      design.replace(
        "<!-- sec:references -->",
        "<!-- sec:notes -->\nUnconfirmed decision.\n\n<!-- sec:references -->",
      ),
    ),
    [summary],
  );
  t.assert.deepEqual(
    missing(design.replace("Parser input type.", "Reader input type.")),
    [{ checkpoint: "design", section: "contract" }],
  );
});
