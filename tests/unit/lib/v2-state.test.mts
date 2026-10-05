import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  observeProgress,
  readState,
} from "../../../core/hooks/lib/v2-state.mjs";
import { states } from "../../helpers/migrate.mjs";

const fixtures = "docs/aidlc-v2-reference/tests/fixtures";

// Derived by hand from each unchanged fixture's checkboxes and migration.json `stages`.
const expected: Record<string, [string, string, string, string, string[]]> = {
  "state-brownfield-feature.md": [
    "active",
    "pending",
    "pending",
    "absent",
    ["saved-search"],
  ],
  "state-brownfield-init-done.md": [
    "pending",
    "skipped",
    "pending",
    "absent",
    [],
  ],
  "state-completed.md": ["completed", "completed", "completed", "absent", []],
  "state-construction-bolt1.md": [
    "completed",
    "active",
    "pending",
    "absent",
    ["widget-cart"],
  ],
  "state-construction-with-worktree.md": [
    "absent",
    "absent",
    "active",
    "absent",
    ["foo"],
  ],
  "state-construction.md": [
    "completed",
    "active",
    "pending",
    "absent",
    ["widget-cart", "widget-checkout"],
  ],
  "state-final-stage.md": ["completed", "completed", "completed", "absent", []],
  "state-init-active.md": ["pending", "pending", "pending", "absent", []],
  "state-initialization-done.md": [
    "pending",
    "pending",
    "pending",
    "absent",
    [],
  ],
  "state-jumped.md": ["completed", "skipped", "active", "absent", []],
  "state-mid-ideation.md": [
    "active",
    "pending",
    "pending",
    "absent",
    ["todo-core"],
  ],
  "state-mid-inception.md": ["active", "skipped", "pending", "absent", []],
  "state-operation.md": ["completed", "completed", "completed", "absent", []],
  "state-pre-workspace-detection.md": [
    "pending",
    "pending",
    "pending",
    "absent",
    [],
  ],
};

test("every v2 state fixture maps its checkboxes onto the four stages", (t) => {
  const readable = states.filter((name) => name !== "state-corrupted.md");
  t.plan(1 + readable.length * 2);
  t.assert.deepEqual(
    readable,
    Object.keys(expected).sort(),
    "all 15 fixtures but the corrupted one",
  );
  for (const name of readable) {
    const state = readState(readFileSync(`${fixtures}/${name}`, "utf8"));
    const progress = observeProgress(state.rows);
    const [intent, design, build, verify, units] = expected[name] ?? [];
    t.assert.deepEqual(state.problems, [], name);
    t.assert.deepEqual(
      [
        progress.intent.state,
        progress.design.state,
        progress.build.state,
        progress.verify.state,
        [
          ...new Set(
            state.rows.flatMap((row) => (row.unit === null ? [] : [row.unit])),
          ),
        ],
      ],
      [intent, design, build, verify, units],
      name,
    );
  }
});

test("state rows keep the raw marks, Units and fields of the file", (t) => {
  const state = readState(
    readFileSync(`${fixtures}/state-construction.md`, "utf8"),
  );
  const progress = observeProgress(state.rows);
  t.plan(6);
  t.assert.equal(state.rows.length, 35);
  t.assert.deepEqual(state.rows.at(21), {
    slug: "functional-design",
    unit: "widget-checkout",
    mark: "-",
    state: "active",
    line: 75,
  });
  t.assert.equal(state.rows.at(-1)?.unit, null, "a phase heading ends a Unit");
  t.assert.equal(
    state.fields.Project,
    "Test widget feature for e-commerce platform",
  );
  t.assert.equal(state.fields["Practices Affirmed Timestamp"], "");
  t.assert.deepEqual(progress.design.stages.slice(0, 4), [
    "refined-mockups [x]",
    "domain-design [x]",
    "contract-design [x]",
    "functional-design [x] (widget-cart)",
  ]);
});

test("unreadable checkboxes are problems, never guessed progress", (t) => {
  const corrupted = readState(
    readFileSync(`${fixtures}/state-corrupted.md`, "utf8"),
  );
  const marks = readState(
    [
      "## Stage Progress",
      "- [?] intent-capture — EXECUTE",
      "- [R] domain-design — EXECUTE",
      "- [x] code-generation — EXECUTE",
      "- [!] user-stories — EXECUTE",
      "- [x] invented-stage — EXECUTE",
      "",
    ].join("\n"),
  );
  const progress = observeProgress(marks.rows);
  t.plan(6);
  t.assert.deepEqual(corrupted.problems, ["no stage checkboxes"]);
  t.assert.deepEqual(readState(null).problems, ["aidlc-state.md is missing"]);
  t.assert.deepEqual(marks.problems, [
    "line 5: unknown checkbox [!]",
    "line 6: unknown v2 stage invented-stage",
  ]);
  t.assert.deepEqual(
    [progress.intent.state, progress.design.state, progress.build.state],
    ["active", "active", "completed"],
    "awaiting approval and revising are still active",
  );
  t.assert.deepEqual(
    observeProgress([
      {
        slug: "intent-capture",
        unit: null,
        mark: "S",
        state: "skipped",
        line: 1,
      },
      {
        slug: "user-stories",
        unit: null,
        mark: "x",
        state: "completed",
        line: 2,
      },
    ]).intent.state,
    "completed",
  );
  t.assert.deepEqual(
    observeProgress([
      {
        slug: "intent-capture",
        unit: null,
        mark: " ",
        state: "pending",
        line: 1,
      },
      {
        slug: "user-stories",
        unit: null,
        mark: "S",
        state: "skipped",
        line: 2,
      },
    ]).intent.state,
    "pending",
  );
});

test("checkbox-shaped lines the strict form rejects are problems, so a valid row cannot hide them", (t) => {
  const state = readState(
    [
      "## Stage Progress",
      "- [x] intent-capture — EXECUTE",
      "- [xx] user-stories — EXECUTE",
      "* [x] domain-design — EXECUTE",
      "-[x] units-generation",
      "- [x] Requirements-Analysis — EXECUTE",
      "- **Project**: not a checkbox",
      "",
    ].join("\n"),
  );
  t.plan(2);
  t.assert.deepEqual(state.problems, [
    "line 3: unreadable checkbox",
    "line 4: unreadable checkbox",
    "line 5: unreadable checkbox",
    "line 6: unreadable checkbox",
  ]);
  t.assert.deepEqual(
    state.rows.map((row) => row.slug),
    ["intent-capture"],
  );
});
