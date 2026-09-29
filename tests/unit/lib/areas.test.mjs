import { test } from "node:test";
import { snapshotIntent } from "../../../core/hooks/lib/approval.mjs";
import {
  classifySegments,
  declaresApproved,
  normalizeSegment,
  parsePatch,
} from "../../../core/hooks/lib/areas.mjs";

const claudeScope = {
  installation: [".claude"],
  installed: ["hooks", "registry", "settings.json", "settings.local.json"],
};

test("normalizeSegment folds case, trailing dots and spaces and stream suffixes", (t) => {
  /** @type {[string,string][]} */
  const cases = [
    ["Events.JSONL. ", "events.jsonl"],
    ["events.jsonl::$DATA", "events.jsonl"],
    ["AUDIT", "audit"],
    ["intent.md:stream", "intent.md"],
    [".", "."],
    ["..", ".."],
    [".claude", ".claude"],
  ];
  t.plan(cases.length);
  for (const [raw, expected] of cases)
    t.assert.equal(normalizeSegment(raw), expected, raw);
});

test("classifySegments names protected areas, their ancestors and glob matches from the root", (t) => {
  /** @type {[string, import('../../../core/hooks/lib/runtime-contracts.mjs').GuardMatch|null][]} */
  const cases = [
    ["vouch/intents/x/audit", { area: "audit", ancestor: false }],
    ["vouch/intents/x/audit/events.jsonl", { area: "audit", ancestor: false }],
    [
      "Vouch/INTENTS/x/Audit./events.jsonl::$DATA",
      { area: "audit", ancestor: false },
    ],
    ["vouch/intents/x/intent.md", { area: "artifact", ancestor: false }],
    ["vouch/intents/x/Design.MD", { area: "artifact", ancestor: false }],
    ["vouch/intents/x/decisions.md", null],
    ["vouch/intents/x/notes/intent.md", null],
    ["vouch/intents/x", { area: "audit", ancestor: true }],
    ["vouch", { area: "audit", ancestor: true }],
    ["", { area: "audit", ancestor: true }],
    [
      "vouch/intents/x/intent.md.vouch-lock/next",
      { area: "lock", ancestor: false },
    ],
    ["src/a.vouch-lock", { area: "lock", ancestor: false }],
    [".claude/settings.json", { area: "installation", ancestor: false }],
    [".claude/hooks/lib/io.mjs", { area: "installation", ancestor: false }],
    [".CLAUDE/Settings.json", { area: "installation", ancestor: false }],
    [".claude", { area: "installation", ancestor: true }],
    [".claude/commands/x.md", null],
    ["docs/vouch/intents/x/audit", null],
    ["vouch/*/x/audit", { area: "audit", ancestor: false }],
    ["vouch/intents/*", { area: "audit", ancestor: true }],
    ["vouch/in*/*/int*.md", { area: "artifact", ancestor: false }],
    ["vouch/**", { area: "audit", ancestor: false }],
    [".claude/*", { area: "installation", ancestor: false }],
    [".claude/[hr]*/x", { area: "installation", ancestor: false }],
    ["vouch/intents/x/aud?t", { area: "audit", ancestor: false }],
    ["vouch/intents/x/[z-a]", { area: "audit", ancestor: false }],
  ];
  t.plan(cases.length + 1);
  for (const [path, expected] of cases)
    t.assert.deepEqual(
      classifySegments(path ? path.split("/") : [], claudeScope),
      expected,
      path,
    );
  t.assert.equal(
    classifySegments([".claude", "settings.json"], {
      installation: null,
      installed: [],
    }),
    null,
  );
});

test("declaresApproved reads any approved frontmatter status and nothing outside it", (t) => {
  const approved = [
    "---\nstatus: approved\n---\n",
    "﻿---\r\nstatus: approved\r\n---\r\nbody",
    "---\ntitle: x\nStatus: 'approved' # ok\n---\n",
    "---\nstatus: approved\n",
    '---\n  status:   "APPROVED"  \n---\n',
  ];
  const other = [
    "---\nstatus: draft\n---\nstatus: approved\n",
    "status: approved\n",
    "",
    "---\nstatus: approved-ish\n---\n",
    "# ---\nstatus: approved\n",
    "---\nstatus: draft\n---\n",
    "---\nstatus: draft\n",
  ];
  t.plan(approved.length + other.length + 1);
  for (const text of approved)
    t.assert.equal(declaresApproved(text), true, JSON.stringify(text));
  for (const text of other)
    t.assert.equal(declaresApproved(text), false, JSON.stringify(text));
  const read = [
    ...approved,
    ...other,
    "---\r\nstatus: approved\r\n---\r\n# x\r\n",
  ];
  t.assert.equal(
    read
      .filter((text) => snapshotIntent(text)?.status === "approved")
      .every(declaresApproved),
    true,
    "a superset of the approved texts snapshotIntent reads",
  );
});

test("parsePatch lists every file operation with its added lines and tolerates spacing", (t) => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: a/new.md",
    "+---",
    "+status: approved",
    "+---",
    "*** Update File: b.md",
    "*** Move to: c.md",
    "@@ context",
    " kept",
    "-old",
    "+new",
    "*** End of File",
    "*** Delete File: d.md",
    "  ***  Update File:   e.md  ",
    "+x",
    "*** End Patch",
  ].join("\n");
  t.plan(2);
  t.assert.deepEqual(parsePatch(patch), [
    {
      kind: "add",
      path: "a/new.md",
      to: null,
      added: ["---", "status: approved", "---"],
    },
    { kind: "update", path: "b.md", to: "c.md", added: ["new"] },
    { kind: "delete", path: "d.md", to: null, added: [] },
    { kind: "update", path: "e.md", to: null, added: ["x"] },
  ]);
  t.assert.deepEqual(parsePatch("no markers\n+line"), []);
});

test("normalizeSegment keeps a stream-only name in lower case", (t) => {
  t.plan(1);
  t.assert.equal(normalizeSegment(":ABC"), ":abc");
});

test("classifySegments anchors areas at the root and reads empty, current and glob segments", (t) => {
  /** @type {[string[], import('../../../core/hooks/lib/runtime-contracts.mjs').GuardMatch|null][]} */
  const cases = [
    [["**"], { area: "audit", ancestor: false }],
    ["vouch//intents/./x/audit".split("/"), { area: "audit", ancestor: false }],
    [["other", "intents", "x", "audit"], null],
    [["docs", "intents", "x", "intent.md"], null],
    [["vouch", "intents", "x", "intent.md", "extra"], null],
    [["vouch", "intents", "x", "au(d)it*"], null],
    [["vouch", "intents", "x", "[!b]udit"], { area: "audit", ancestor: false }],
  ];
  t.plan(cases.length);
  for (const [segments, expected] of cases)
    t.assert.deepEqual(
      classifySegments(segments, claudeScope),
      expected,
      segments.join("/"),
    );
});

test("declaresApproved needs a leading delimiter and a status key and ignores indented delimiters", (t) => {
  /** @type {[string, boolean][]} */
  const cases = [
    [" ---\nstatus: approved\n---\n", false],
    ["---\nnote: status: approved\n---\n", false],
    ["---\nstatusx: approved\n---\n", false],
    ["---\nstatus: draft\n  ---\nstatus: approved\n", true],
  ];
  t.plan(cases.length);
  for (const [text, expected] of cases)
    t.assert.equal(declaresApproved(text), expected, JSON.stringify(text));
});

test("parsePatch needs markers at the start of a line and accepts a move without a space", (t) => {
  t.plan(2);
  t.assert.deepEqual(parsePatch("x *** Update File: a\n+b"), []);
  t.assert.deepEqual(parsePatch("*** Update File: b\n*** Move to:c.md"), [
    { kind: "update", path: "b", to: "c.md", added: [] },
  ]);
});
