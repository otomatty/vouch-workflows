import { hookTest as test } from "../helpers/hook-test.mjs";
import {
  approvalBox,
  artifact,
  audit,
  intent,
  planned,
} from "../helpers/intent-review.mjs";
import { runHook } from "../helpers/runtime.mjs";
import { toolFixture } from "../helpers/write-guard.mjs";

// Build start boundary: docs/development/approval-boundary.md.
const draft = planned();
const approved = draft.replace("status: draft", "status: approved");
/** @param {...string} lines */
const patch = (...lines) =>
  ["*** Begin Patch", ...lines, "*** End Patch", ""].join("\n");

/**
 * Implementation writes through each harness's file edit tools, derived from Linux captures.
 * @param {string} root @param {string} path
 * @returns {['claude'|'codex',string,Record<string,unknown>][]}
 */
const writes = (root, path) => [
  ["claude", "Write", { file_path: `${root}/${path}`, content: "x\n" }],
  [
    "claude",
    "Edit",
    {
      file_path: `${root}/${path}`,
      old_string: "a",
      new_string: "b",
      replace_all: false,
    },
  ],
  ["codex", "apply_patch", { command: patch(`*** Add File: ${path}`, "+x") }],
];

/** @param {{root:string}} box @param {'claude'|'codex'} harness @param {string} tool @param {Record<string,unknown>} input @param {string} [scope] */
const guard = (box, harness, tool, input, scope = intent) =>
  runHook("vouch-guard-writes", toolFixture(harness, tool, box.root, input), {
    root: box.root,
    intent: scope,
  });

test("file edits outside vouch wait for the configured Intent's approved plan", async (t) => {
  const box = await approvalBox(t);
  const denied = writes(box.root, "src/app.js").map(([harness, tool, input]) =>
    guard(box, harness, tool, input),
  );
  const buildLog = guard(box, "claude", "Write", {
    file_path: box.path(`vouch/intents/${intent}/build-log.md`),
    content: "# Build\n",
  });
  const { result } = await box.approveAfter();
  const allowed = [
    ...writes(box.root, "src/app.js"),
    [
      "claude",
      "Write",
      {
        file_path: box.path(`vouch/intents/${intent}/build-log.md`),
        content: "x\n",
      },
    ],
  ].map(([harness, tool, input]) =>
    guard(
      box,
      /** @type {'claude'|'codex'} */ (harness),
      /** @type {string} */ (tool),
      /** @type {Record<string,unknown>} */ (input),
    ),
  );
  t.plan(denied.length * 2 + allowed.length + 3);
  for (const item of denied) {
    t.assert.equal(item.exitCode, 2);
    t.assert.match(
      item.stderr,
      /^VOUCH-BUILD-UNAPPROVED: (?:Write|Edit|apply_patch) src\/app\.js; .*draft.*\n$/,
    );
  }
  t.assert.match(buildLog.stderr, /^VOUCH-BUILD-UNAPPROVED: Write /);
  t.assert.match(result.stderr, /^VOUCH-APPROVAL-APPLIED: /);
  t.assert.equal(await box.read(artifact), approved);
  for (const item of allowed)
    t.assert.deepEqual([item.exitCode, item.stderr], [0, ""]);
});

test("drafting inside vouch, unscoped sessions and shell commands are outside the boundary", async (t) => {
  const box = await approvalBox(t, "codex");
  const results = [
    guard(box, "claude", "Edit", {
      file_path: box.path(artifact),
      old_string: "AC-1: keep evidence.",
      new_string: "AC-1: keep every piece of evidence.",
      replace_all: false,
    }),
    guard(box, "claude", "Write", {
      file_path: box.path(`vouch/intents/${intent}/decisions.md`),
      content: "# Decisions\n",
    }),
    guard(box, "codex", "apply_patch", {
      command: patch("*** Add File: vouch/knowledge/codekb/app.md", "+x"),
    }),
    guard(
      box,
      "claude",
      "Write",
      { file_path: box.path("src/app.js"), content: "x" },
      "",
    ),
    guard(box, "claude", "Bash", { command: "npm test > test-output.txt" }),
  ];
  t.plan(results.length);
  for (const result of results)
    t.assert.deepEqual([result.exitCode, result.stderr], [0, ""]);
});

test("approved artifacts without matching evidence and unreadable logs deny implementation writes", async (t) => {
  const bare = await approvalBox(t);
  await bare.write(artifact, approved);
  const unevidenced = guard(bare, "claude", "Write", {
    file_path: bare.path("src/app.js"),
    content: "x",
  });
  const stale = await approvalBox(t, "codex");
  await stale.approveAfter();
  await stale.write(artifact, `${approved}Edited outside the harness.\n`);
  const edited = guard(stale, "codex", "apply_patch", {
    command: patch("*** Add File: src/app.js", "+x"),
  });
  const corrupt = await approvalBox(t);
  await corrupt.approveAfter();
  await corrupt.write(audit, "broken\n");
  const unreadable = guard(corrupt, "claude", "Write", {
    file_path: corrupt.path("src/app.js"),
    content: "x",
  });
  const missing = await approvalBox(t);
  await missing.write(artifact, "");
  const absent = guard(missing, "claude", "Write", {
    file_path: missing.path("src/app.js"),
    content: "x",
  });
  t.plan(8);
  t.assert.equal(unevidenced.exitCode, 2);
  t.assert.match(unevidenced.stderr, /no approval evidence/);
  t.assert.equal(edited.exitCode, 2);
  t.assert.match(edited.stderr, /no approval evidence/);
  t.assert.equal(unreadable.exitCode, 2);
  t.assert.match(unreadable.stderr, /unreadable/);
  t.assert.equal(absent.exitCode, 2);
  t.assert.match(absent.stderr, /^VOUCH-BUILD-UNAPPROVED: /);
});

test("the write guard reasons keep priority over the Build boundary", async (t) => {
  const box = await approvalBox(t);
  const result = guard(box, "claude", "Write", {
    file_path: box.path(audit),
    content: "{}\n",
  });
  t.plan(2);
  t.assert.equal(result.exitCode, 2);
  t.assert.match(result.stderr, /^VOUCH-GUARD-AUDIT: /);
});
