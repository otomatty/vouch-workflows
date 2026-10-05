import { test } from "node:test";
import {
  expectedArtifacts,
  readCodekb,
  routeFile,
} from "../../../core/hooks/lib/migrate-plan.mjs";

test("record files follow every matching rule until a final one", (t) => {
  const cases: [string, string | null, { to: string[]; note?: string }][] = [
    ["aidlc-state.md", null, { to: ["migration.md#progress"] }],
    ["audit/host.md", null, { to: ["audit/events.jsonl"] }],
    [
      "ideation/intent-capture/intent-statement.md",
      null,
      { to: ["intent.md#analysis", "vouch/knowledge/background/"] },
    ],
    [
      "ideation/approval-handoff/decision-log.md",
      null,
      {
        to: [
          "intent.md#analysis",
          "vouch/knowledge/background/",
          "decisions.md#decisions",
        ],
      },
    ],
    [
      "inception/user-stories/stories.md",
      null,
      { to: ["intent.md#acceptance"] },
    ],
    [
      "inception/delivery-planning/bolt-plan.md",
      null,
      { to: ["design.md", "intent.md#plan"] },
    ],
    [
      "inception/contract-design/contract-summary.md",
      null,
      {
        to: ["design.md#contract", "intent.md#plan", "vouch/knowledge/design/"],
      },
    ],
    [
      "inception/refined-mockups/mockups.md",
      null,
      { to: ["design.md#diagrams"] },
    ],
    [
      "inception/practices-discovery/team-practices.md",
      null,
      { to: ["vouch/rules.md"] },
    ],
    [
      "construction/cart/nfr-design/security-design.md",
      null,
      { to: ["design.md#units"] },
    ],
    [
      "construction/cart/infrastructure-design/cicd-pipeline.md",
      null,
      { to: ["design.md#units", "vouch/knowledge/infra/"] },
    ],
    [
      "construction/cart/code-generation/code-summary.md",
      "# Summary\n",
      { to: ["build-log.md#units"] },
    ],
    [
      "construction/cart/code-generation/code-summary.md",
      "# Summary\r\n\r\n## Review\r\nREADY\r\n",
      { to: ["build-log.md#units", "review.md#references"] },
    ],
    [
      "construction/cart/code-generation/code-summary.md",
      "## Reviewers\n",
      { to: ["build-log.md#units"] },
    ],
    [
      "construction/build-and-test/test-results.md",
      null,
      { to: ["build-log.md#verification"] },
    ],
    [
      "construction/cart/code-generation/code-generation-questions.md",
      null,
      { to: ["build-log.md#units", "decisions.md#decisions"] },
    ],
    [
      "inception/requirements-analysis/memory.md",
      null,
      { to: [], note: "diary" },
    ],
    [
      "operation/deployment-pipeline/cd-config.md",
      null,
      { to: [], note: "operation" },
    ],
    [
      "verification/phase-check-ideation.md",
      null,
      { to: [], note: "bootstrap" },
    ],
    [
      "initialization/state-init/state-init-summary.md",
      null,
      { to: [], note: "bootstrap" },
    ],
    [
      "archive/2025-06-15-intent-capture/old.md",
      null,
      { to: [], note: "history" },
    ],
    ["runtime-graph.json", null, { to: [], note: "transient" }],
    [".aidlc-recovery.md", null, { to: [], note: "transient" }],
    ["notes/extra.md", null, { to: [], note: "unmatched" }],
  ];
  t.plan(cases.length);
  for (const [origin, text, expected] of cases)
    t.assert.deepEqual(
      routeFile("record", origin, text, false),
      expected,
      origin,
    );
});

test("space files carry the repo and need affirmation evidence for rules", (t) => {
  t.plan(6);
  t.assert.deepEqual(
    routeFile("space", "codekb/widget-app/architecture.md", null, false),
    { to: ["vouch/knowledge/codekb/widget-app/"] },
  );
  t.assert.deepEqual(routeFile("space", "memory/team.md", null, false), {
    to: [],
    note: "unaffirmed",
  });
  t.assert.deepEqual(routeFile("space", "memory/project.md", null, true), {
    to: ["vouch/rules.md"],
  });
  t.assert.deepEqual(routeFile("space", "memory/org.md", null, true), {
    to: [],
    note: "default",
  });
  t.assert.deepEqual(
    routeFile("space", "memory/phases/inception.md", null, true),
    { to: [], note: "default" },
  );
  t.assert.deepEqual(routeFile("space", "codekb/UPPER/x.md", null, true), {
    to: [],
    note: "unmatched",
  });
});

test("expected artifacts are the Intent documents the destinations name, plus the required ones", (t) => {
  t.plan(2);
  t.assert.deepEqual(
    expectedArtifacts([
      ["review.md#references", "vouch/rules.md"],
      ["design.md", "audit/events.jsonl", "migration.md#progress"],
    ]),
    ["intent.md", "design.md", "review.md", "decisions.md"],
  );
  t.assert.deepEqual(expectedArtifacts([]), ["intent.md", "decisions.md"]);
});

test("codekb observations read the scan date and commit without trusting a short commit, for routed repos only", (t) => {
  const stamp = (commit: string) =>
    `# Reverse Engineering Timestamp\n\n## Run Record\n\n- Date: 2026-07-27\n- Commit: ${commit}\n`;
  t.plan(3);
  t.assert.deepEqual(
    readCodekb([
      ["codekb/widget-app/architecture.md", null],
      [
        "codekb/widget-app/reverse-engineering-timestamp.md",
        stamp("fixture (no repository)"),
      ],
      ["codekb/api/a.md", null],
      ["codekb/UPPER/x.md", null],
      ["memory/team.md", null],
    ]),
    [
      { repo: "api", files: 1, scanned: null, commit: null, verifiable: false },
      {
        repo: "widget-app",
        files: 2,
        scanned: "2026-07-27",
        commit: "fixture (no repository)",
        verifiable: false,
      },
    ],
  );
  t.assert.equal(
    readCodekb([
      ["codekb/a/reverse-engineering-timestamp.md", stamp("a".repeat(40))],
    ])[0]?.verifiable,
    true,
  );
  t.assert.equal(
    readCodekb([
      ["codekb/a/reverse-engineering-timestamp.md", stamp("abc1234")],
    ])[0]?.verifiable,
    false,
  );
});
