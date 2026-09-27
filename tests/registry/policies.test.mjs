import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

for (const name of [
  "quality-layers",
  "diagrams",
  "enforcement-map",
  "workflow",
]) {
  test(`${name} satisfies its closed registry schema`, (t) => {
    const data = readJson(`core/registry/${name}.json`);
    const validate = validator(name);
    t.plan(2);
    t.assert.equal(
      validate(data),
      true,
      `REG-1: ${name}: ${JSON.stringify(validate.errors)}`,
    );
    t.assert.equal(
      validate({ ...data, unknown: true }),
      false,
      `REG-1: ${name} rejects unknown metadata`,
    );
  });
}

test("quality layers implement the Q3 matrix and separate dependency auditing", (t) => {
  const data = readJson("core/registry/quality-layers.json");
  const matrix = {
    correctness: "RRR",
    contract: "RRR",
    maintainability: "RRR",
    rationale: "RRR",
    testing: "NRR",
    requirements: "ORR",
    design: "ORR",
    root_cause: "ORR",
    security: "NOR",
    nonfunctional: "NOR",
    exploration: "NOR",
  };
  t.plan(Object.keys(matrix).length + 4);
  t.assert.deepEqual(
    data.layers.map((/** @type {{id:string}} */ row) => row.id).sort(),
    Object.keys(matrix).sort(),
    "Q3: exact layers",
  );
  for (const [id, code] of Object.entries(matrix)) {
    const row = data.layers.find(
      (/** @type {{id:string}} */ row) => row.id === id,
    );
    t.assert.deepEqual(
      ["L", "M", "H"].map((tier) => row.tiers[tier]),
      [...code].map((c) =>
        c === "R" ? "required" : c === "O" ? "optional" : "not-applicable",
      ),
      `Q3: ${id}`,
    );
  }
  t.assert.deepEqual(
    ["L", "M", "H"].map(
      (tier) =>
        data.layers.filter(
          (/** @type {{tiers:Record<string,string>}} */ row) =>
            row.tiers[tier] === "required",
        ).length,
    ),
    [4, 8, 11],
    "Q3: counts",
  );
  t.assert.deepEqual(data.sabotage, { L: 0, M: 1, H: 3 }, "Q3: sabotage");
  t.assert.deepEqual(
    data.dependency_audit,
    ["L", "M", "H"],
    "Q3: DoD at every tier",
  );
});

test("diagram registry preserves every required and conditional Q4 diagram", (t) => {
  const data = readJson("core/registry/diagrams.json");
  const expected = {
    knowledge: [
      ["components", "flowchart", "always", 1],
      ["data", "erDiagram", "database", 1],
    ],
    intent: [
      ["user-flow", "flowchart", "always", 1],
      ["impact", "flowchart", "brownfield", 1],
    ],
    design: [
      ["components-diff", "flowchart", "always", 1],
      ["sequence", "sequenceDiagram", "always", 1],
      ["data-diff", "erDiagram", "schema-change", 1],
      ["lifecycle", "stateDiagram-v2", "lifecycle-change", 1],
      ["contract", "classDiagram", "public-api-change", 1],
    ],
    review: [
      ["main-flow", "sequenceDiagram", "always", 1],
      ["before-after", "screenshot", "ui-change", 2],
      ["design-diff", "design-reference", "design-change", 1],
    ],
  };
  t.plan(8);
  t.assert.deepEqual(
    data.mermaid,
    [
      "flowchart",
      "sequenceDiagram",
      "classDiagram",
      "erDiagram",
      "stateDiagram-v2",
    ],
    "Q4: stable kinds",
  );
  for (const [artifact, rows] of Object.entries(expected))
    t.assert.deepEqual(
      data.artifacts[artifact].map(
        (/** @type {{id:string,kind:string,when:string,count:number}} */ d) => [
          d.id,
          d.kind,
          d.when,
          d.count,
        ],
      ),
      rows,
      `Q4: ${artifact}`,
    );
  for (const [key, color] of Object.entries({
    added: "green",
    changed: "orange",
    removed: "red",
  }))
    t.assert.deepEqual(
      [
        data.diff[key].color,
        data.diff[key].classDef.includes(`classDef ${key}`),
      ],
      [color, true],
      `Q4: ${key}`,
    );
});

test("workflow defaults reflect the settled Q2 Q5 and Q6 choices", (t) => {
  const data = readJson("core/registry/workflow.json");
  t.plan(8);
  t.assert.deepEqual(
    data.stages,
    ["intent", "design", "build", "verify"],
    "§18: four stages",
  );
  t.assert.deepEqual(
    data.agents,
    ["builder", "reviewer", "explorer"],
    "§5: roles",
  );
  t.assert.deepEqual(
    data.defaults,
    {
      language: "ja",
      checkpoints: "topic",
      verification_environment: "local",
      auto_merge: false,
    },
    "§18: defaults",
  );
  t.assert.deepEqual(
    data.topic_checkpoints,
    [
      { id: "acceptance", when: "always" },
      { id: "scope", when: "always" },
      { id: "units", when: "always" },
      { id: "design", when: "design-required" },
    ],
    "Q2: four topics",
  );
  t.assert.equal(data.high_risk_adds, "unit", "Q2: H unit checkpoints");
  t.assert.deepEqual(
    data.checkpoint_modes,
    ["topic", "unit", "section"],
    "Q2: choices",
  );
  t.assert.deepEqual(data.languages, ["ja", "en"], "Q6: languages");
  t.assert.deepEqual(
    data.verification,
    { local: "Playwright", services: "compose", ci: "demo.sh" },
    "Q5: environments",
  );
});

test("enforcement inventory covers all specification rule IDs with honest evidence paths", (t) => {
  const html = readFileSync(
    "docs/spec/vouch-implementation-rules.html",
    "utf8",
  );
  const ids = [
    ...new Set(
      [
        ...html.matchAll(
          /<td[^>]*>\s*((?:STR|HOOK|REG|DOC|DIST|DEP|TEST)-\d+)\s*<\/td>/g,
        ),
      ].map((m) => m[1]),
    ),
  ];
  const map = readJson("core/registry/enforcement-map.json");
  t.plan(ids.length + 2);
  t.assert.equal(ids.length, 57, "REG-4: source inventory");
  t.assert.deepEqual(
    Object.keys(map.rules).sort(),
    ids.map((id) => `R-${id}`).sort(),
    "REG-4: complete rule inventory",
  );
  for (const id of ids) {
    const row = map.rules[`R-${id}`];
    t.assert.equal(
      row.rule_id === id &&
        row.checks.every(
          (/** @type {{status:string,path?:string}} */ c) =>
            c.status === "pending" || (c.path && existsSync(c.path)),
        ),
      true,
      `REG-4: ${id} evidence`,
    );
  }
});

test("unimplemented emission and process guarantees remain explicitly pending", (t) => {
  const map = readJson("core/registry/enforcement-map.json");
  const pending = [
    "REG-2",
    "HOOK-2",
    "HOOK-3",
    "HOOK-6",
    "HOOK-9",
    "HOOK-13",
    "HOOK-14",
    "TEST-7",
    "TEST-14",
    "DIST-1",
  ];
  t.plan(pending.length);
  for (const id of pending)
    t.assert.equal(
      map.rules[`R-${id}`].checks.some(
        (/** @type {{status:string}} */ c) => c.status === "pending",
      ),
      true,
      `${id}: cannot claim runtime completion`,
    );
});
