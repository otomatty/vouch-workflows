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
} from "../../../core/hooks/lib/checkpoints.mjs";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import { confirmation } from "../../helpers/approval.mjs";
import { planned } from "../../helpers/intent-review.mjs";

/** @param {string} text */
const sha = (text) => createHash("sha256").update(text).digest("hex");
/** @param {string} text @param {string} id */
const section = (text, id) => {
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
  t.plan(5);
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
});

test("an H Unit requires Design even when every row declares none", (t) => {
  t.plan(2);
  const result = readPlan(planned([["U1", "H: schema", "required: contract"]]));
  t.assert.equal("plan" in result && result.plan.design, true);
  t.assert.match(
    /** @type {{error:string}} */ (
      readPlan(planned([["U1", "H: schema", "not-required: none"]]))
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
    `${plan.replace(/\| U1 .*\n/, "")}`.replace(
      "| --- | --- | --- | --- | --- |",
      "| --- | --- | --- | --- | --- |\nnot a row",
    ),
  ];
  t.plan(cases.length);
  for (const text of cases)
    t.assert.equal(typeof readPlan(text).error, "string", text.slice(0, 400));
});

test("checkpoint modes come from rules.md frontmatter or the workflow default", (t) => {
  const rules = (/** @type {string} */ body) =>
    `---\nlanguage: ja\n${body}\n---\n# Rules\n`;
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
    [`${rules("language: en")}checkpoints: unit\n`, null],
    [`﻿${rules("checkpoints: unit")}`, null],
  ];
  t.plan(cases.length);
  for (const [text, mode] of cases)
    t.assert.equal(readCheckpointMode(text), mode, JSON.stringify(text));
});

test("required checkpoints follow the mode, the Design condition and H Unit additions", (t) => {
  /** @param {string} text */
  const plan = (text) => {
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
  const units = (/** @type {string[]} */ ...ids) =>
    ids.map((id) => ({ checkpoint: "unit", unit: id }));
  t.plan(7);
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
    { checkpoint: "design" },
  ]);
  t.assert.deepEqual(requiredCheckpoints("unit", high), [
    { checkpoint: "acceptance" },
    ...units("U1", "U2"),
    { checkpoint: "design" },
  ]);
  t.assert.deepEqual(requiredCheckpoints("section", low), sections);
  t.assert.deepEqual(requiredCheckpoints("section", high), [
    ...sections,
    ...units("U1", "U2"),
    { checkpoint: "design" },
  ]);
});

test("checkpoint content digests the exact confirmed section, row or normalized design", (t) => {
  const text = planned(mixed);
  const design = "---\nstatus: draft\n---\n# Design\n\nDiff diagram.\n";
  const texts = { intent: text, design };
  const intent = (/** @type {string} */ part) => ({
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
      "| U-2.b | AC-1 | src | M — internal | required — contract diagram |",
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
    intent("| U1 | AC-1 | src | L: wording | not-required: none |"),
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
    [{ checkpoint: "design" }, { intent: text, design: "# No frontmatter\n" }],
  ];
  t.plan(cases.length);
  for (const [target, value] of cases)
    t.assert.equal(
      checkpointContent(
        /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').CheckpointTarget} */ (
          target
        ),
        /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').ArtifactTexts} */ (
          value
        ),
      ),
      null,
      JSON.stringify(target),
    );
});

test("targets are described with the confirm command suffix", (t) => {
  t.plan(3);
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
  /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').CheckpointTarget[]} */
  const required = [
    { checkpoint: "acceptance" },
    { checkpoint: "unit", unit: "U1" },
    { checkpoint: "section", section: "scope" },
    { checkpoint: "design" },
  ];
  const content = (
    /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').CheckpointTarget} */ target,
  ) => {
    const value = checkpointContent(target, artifacts);
    if (!value) throw new Error("no content");
    return value;
  };
  const valid = required.map((target) =>
    confirmation(target, content(target), { intent }),
  );
  const query = (/** @type {unknown[]} */ events) =>
    missingCheckpoints({
      required,
      events: /** @type {never} */ (events),
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
  const replaced = (/** @type {object} */ change) => [
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
