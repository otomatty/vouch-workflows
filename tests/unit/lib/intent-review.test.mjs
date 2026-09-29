import { test } from "node:test";
import {
  approvedText,
  snapshotIntent,
} from "../../../core/hooks/lib/approval.mjs";
import { createIntentAuditStore } from "../../../core/hooks/lib/audit.mjs";
import { checkpointContent } from "../../../core/hooks/lib/checkpoints.mjs";
import { newId, sha256Hex } from "../../../core/hooks/lib/clock.mjs";
import {
  parseIntentReviewCommand,
  reviewIntent,
} from "../../../core/hooks/lib/intent-review.mjs";
import { planned } from "../../helpers/intent-review.mjs";
import { memoryFiles } from "../../helpers/runtime.mjs";

test("review commands are exact operator inputs and do not infer consent", (t) => {
  const gate = `evt_${"a".repeat(64)}`;
  const cases = [
    ["vouch review", { kind: "open" }],
    [`vouch approve ${gate}`, { kind: "approve", gate }],
    ["yes", null],
    ["承認します", null],
    [`Please vouch approve ${gate}`, null],
    ["vouch reviewer", null],
    ["vouch reviews tomorrow", null],
    ["vouch approves tomorrow", null],
    ["vouch review ", { kind: "invalid" }],
    ["vouch review\n", { kind: "invalid" }],
    ["vouch approve", { kind: "invalid" }],
    ["vouch approve\tbad", { kind: "invalid" }],
    ["vouch review\r", { kind: "invalid" }],
    ["vouch review\t", { kind: "invalid" }],
    ["vouch approve nope", { kind: "invalid" }],
    [`vouch approve ${gate}\n`, { kind: "invalid" }],
    [`vouch approve ${gate} `, { kind: "invalid" }],
    [`vouch approve evt_${"A".repeat(64)}`, { kind: "invalid" }],
    [" vouch review", null],
    ["vouch approveX", null],
  ];
  t.plan(cases.length);
  for (const [input, expected] of cases)
    t.assert.deepEqual(parseIntentReviewCommand(String(input)), expected);
});

test("confirm commands name one checkpoint target exactly", (t) => {
  const cases = [
    ["vouch confirm acceptance", { checkpoint: "acceptance" }],
    ["vouch confirm scope", { checkpoint: "scope" }],
    ["vouch confirm units", { checkpoint: "units" }],
    ["vouch confirm design", { checkpoint: "design" }],
    ["vouch confirm unit U-2.b", { checkpoint: "unit", unit: "U-2.b" }],
    ["vouch confirm section plan", { checkpoint: "section", section: "plan" }],
  ];
  const invalid = [
    "vouch confirm",
    "vouch confirm ",
    "vouch confirm everything",
    "vouch confirm unit",
    "vouch confirm unit U 1",
    "vouch confirm unit -U1",
    "vouch confirm section Plan",
    "vouch confirm acceptance\n",
    "vouch confirm  acceptance",
    "vouch confirm\tacceptance",
  ];
  t.plan(cases.length + invalid.length + 2);
  for (const [input, target] of cases)
    t.assert.deepEqual(parseIntentReviewCommand(String(input)), {
      kind: "confirm",
      target,
    });
  for (const input of invalid)
    t.assert.deepEqual(
      parseIntentReviewCommand(input),
      { kind: "invalid" },
      JSON.stringify(input),
    );
  t.assert.equal(parseIntentReviewCommand("vouch confirmed"), null);
  t.assert.equal(
    parseIntentReviewCommand("please vouch confirm acceptance"),
    null,
  );
});

const intent = "260929-plan";
const artifact = `vouch/intents/${intent}/intent.md`;
const design = `vouch/intents/${intent}/design.md`;

/**
 * The review main over an in-memory project; `send` appends and applies as io.run does.
 * @param {Record<string,string>} initial @param {'claude'|'codex'} [harness]
 */
function project(initial, harness = "claude") {
  const files = memoryFiles(initial);
  const audit = createIntentAuditStore(files, intent);
  let count = 0;
  let instant = "2026-09-29T00:00:00Z";
  /** @type {import('../../../core/hooks/lib/contracts.mjs').ReadyHookContext} */
  const ctx = {
    projectRoot: "/project",
    harness,
    intent,
    generation: "test",
    now: () => instant,
    newId,
    readText: files.readText,
    locate: files.locate,
    audit,
  };
  /** @param {string} prompt @param {{identity?:string,at?:string,session?:string}} [options] */
  async function send(prompt, options = {}) {
    if (options.at) instant = options.at;
    const identity = options.identity ?? `id-${++count}`;
    /** @type {import('../../../core/hooks/lib/contracts.mjs').HookInput} */
    const input = {
      hook_event_name: "UserPromptSubmit",
      session_id: options.session ?? "s-1",
      cwd: "/project",
      prompt,
      [harness === "claude" ? "prompt_id" : "turn_id"]: identity,
    };
    const result = await reviewIntent(input, ctx);
    if (result.events?.length) await audit.append(result.events);
    if (result.decision === "deny" && result.approve) {
      const approved = approvedText(
        (await files.readText(artifact)) ?? "",
        result.approve.sha256,
      );
      if (approved === null) throw new Error("APPROVAL-STALE");
      files.data.set(artifact, approved);
    }
    return result;
  }
  return { files, audit, send, ctx };
}

/** @param {{reason?:string}} result */
const reason = (result) => result.reason ?? "";

test("review main allows unrelated, unscoped and non-prompt input without reading", async (t) => {
  const { send, ctx } = project({});
  t.plan(3);
  t.assert.deepEqual(await send("yes"), { decision: "allow" });
  t.assert.deepEqual(
    await reviewIntent(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "s",
        cwd: "/project",
        prompt: "vouch review",
        prompt_id: "unscoped",
      },
      { ...ctx, intent: "" },
    ),
    { decision: "allow" },
  );
  t.assert.deepEqual(
    await reviewIntent(
      {
        hook_event_name: "SessionStart",
        session_id: "s",
        cwd: "/project",
        source: "startup",
      },
      ctx,
    ),
    { decision: "allow" },
  );
});

test("review main refuses malformed commands, missing identity and non-draft artifacts", async (t) => {
  const { send, ctx, files } = project({});
  t.plan(5);
  t.assert.match(
    reason(await send("vouch confirm nothing")),
    /^VOUCH-REVIEW-COMMAND/,
  );
  t.assert.match(
    reason(
      await reviewIntent(
        {
          hook_event_name: "UserPromptSubmit",
          session_id: "s",
          cwd: "/project",
          prompt: "vouch confirm acceptance",
        },
        ctx,
      ),
    ),
    /^VOUCH-REVIEW-IDENTITY/,
  );
  t.assert.match(
    reason(await send("vouch confirm acceptance")),
    /^VOUCH-REVIEW-DRAFT/,
  );
  files.data.set(
    artifact,
    planned().replace("status: draft", "status: approved"),
  );
  t.assert.match(
    reason(await send("vouch confirm acceptance")),
    /^VOUCH-REVIEW-DRAFT/,
  );
  t.assert.equal(
    files.data.has(`vouch/intents/${intent}/audit/events.jsonl`),
    false,
  );
});

test("confirmations record the digest of the confirmed part with derived identity", async (t) => {
  const text = planned([
    ["U1", "L", "not-required"],
    ["U2", "M", "required"],
  ]);
  const designText = "---\nstatus: draft\n---\n# Design\n";
  const { send, audit } = project(
    { [artifact]: text, [design]: designText },
    "codex",
  );
  const accepted = await send("vouch confirm acceptance", {
    identity: "turn-a",
  });
  const unit = await send("vouch confirm unit U2");
  const designed = await send("vouch confirm design");
  const absent = await send("vouch confirm section nowhere");
  const rows = await audit.list();
  const [first] = rows;
  t.plan(9);
  t.assert.match(
    reason(accepted),
    /^VOUCH-CHECKPOINT-RECORDED: evt_[a-f0-9]{64}; acceptance$/,
  );
  t.assert.match(reason(unit), /; unit U2$/);
  t.assert.match(reason(designed), /; design$/);
  t.assert.match(reason(absent), /^VOUCH-CHECKPOINT-TARGET: section nowhere/);
  t.assert.equal(rows.length, 3);
  t.assert.deepEqual(first, {
    id: newId(
      "s-1",
      JSON.stringify([
        "checkpoint.confirmed",
        "codex",
        intent,
        "turn_id",
        "turn-a",
      ]),
    ),
    v: 1,
    type: "checkpoint.confirmed",
    ts: "2026-09-29T00:00:00Z",
    actor: "human",
    harness: "codex",
    intent,
    session: "s-1",
    checkpoint: "acceptance",
    content: checkpointContent(
      { checkpoint: "acceptance" },
      { intent: text, design: null },
    ),
    submission: {
      hook_event_name: "UserPromptSubmit",
      field: "turn_id",
      id: "turn-a",
      prompt_sha256: sha256Hex(Buffer.from("vouch confirm acceptance")),
    },
  });
  t.assert.deepEqual(
    [
      rows[1]?.type === "checkpoint.confirmed" && rows[1].unit,
      rows[2]?.type === "checkpoint.confirmed" && rows[2].content?.path,
    ],
    ["U2", "design.md"],
  );
  t.assert.equal("approve" in accepted, false);
  t.assert.equal(accepted.events?.length, 1);
});

test("replays keep the first time and synthetic records cannot be reused", async (t) => {
  const { send, audit } = project({ [artifact]: planned() });
  await send("vouch confirm acceptance", { identity: "same" });
  const replay = await send("vouch confirm acceptance", {
    identity: "same",
    at: "2026-09-30T00:00:00Z",
  });
  const [row] = await audit.list();
  t.plan(4);
  t.assert.equal(replay.events?.[0]?.ts, "2026-09-29T00:00:00Z");
  t.assert.deepEqual(replay.events?.[0], row);
  const other = project({ [artifact]: planned() });
  const forged = { .../** @type {object} */ (row), synthetic: true };
  await other.audit.append([/** @type {never} */ (forged)]);
  const reused = await other.send("vouch confirm acceptance", {
    identity: "same",
  });
  t.assert.match(reason(reused), /^VOUCH-REVIEW-EVIDENCE: synthetic/);
  t.assert.equal(reused.events, undefined);
});

test("an approval applies only when rules, plan and every current checkpoint agree", async (t) => {
  const { send, files, audit } = project({ [artifact]: planned() });
  await send("vouch review");
  const [gate] = await audit.list();
  if (!gate) throw new Error("gate");
  const early = await send(`vouch approve ${gate.id}`, {
    at: "2026-09-29T00:00:02Z",
  });
  const again = await send(`vouch approve ${gate.id}`);
  const rows = await audit.list();
  t.plan(10);
  t.assert.match(
    reason(early),
    /^VOUCH-APPROVAL-RECORDED: evt_[a-f0-9]{64}; not applied: checkpoints acceptance, scope, units$/,
  );
  t.assert.equal("approve" in early, false);
  t.assert.deepEqual(again.events ?? [], []);
  t.assert.match(
    reason(again),
    new RegExp(`^VOUCH-APPROVAL-RECORDED: ${rows[1]?.id}; not applied`),
  );
  t.assert.equal(rows.length, 2);
  await send("vouch confirm acceptance");
  await send("vouch confirm scope");
  const last = await send("vouch confirm units");
  t.assert.match(
    reason(last),
    new RegExp(
      `^VOUCH-CHECKPOINT-RECORDED: evt_[a-f0-9]{64}; units; approval ${rows[1]?.id} applied; intent\\.md approved$`,
    ),
  );
  t.assert.deepEqual("approve" in last && last.approve, {
    sha256: snapshotIntent(planned())?.revision.sha256,
  });
  t.assert.equal(
    files.data.get(artifact),
    planned().replace("status: draft", "status: approved"),
  );
  t.assert.equal(
    (await audit.list()).filter((row) => row.type === "intent.approved").length,
    1,
  );
  t.assert.match(
    reason(await send("vouch confirm units")),
    /^VOUCH-REVIEW-DRAFT/,
  );
});

test("confirmed checkpoints let the approval itself apply the same revision", async (t) => {
  const { send, files, audit } = project({ [artifact]: planned() });
  for (const target of ["acceptance", "scope", "units"])
    await send(`vouch confirm ${target}`);
  await send("vouch review");
  const gate = (await audit.list()).find((row) => row.type === "gate.opened");
  const applied = await send(`vouch approve ${gate?.id}`, {
    at: "2026-09-29T00:00:04Z",
  });
  t.plan(4);
  t.assert.match(
    reason(applied),
    /^VOUCH-APPROVAL-APPLIED: evt_[a-f0-9]{64}; intent\.md approved at revision [a-f0-9]{12}$/,
  );
  t.assert.equal(applied.events?.[0]?.type, "intent.approved");
  t.assert.deepEqual("approve" in applied && applied.approve, {
    sha256: snapshotIntent(planned())?.revision.sha256,
  });
  t.assert.equal(
    snapshotIntent(files.data.get(artifact) ?? "")?.status,
    "approved",
  );
});

test("stale checkpoints, invalid rules and invalid plans leave the approval unapplied", async (t) => {
  /** @param {Record<string,string>} extra @param {(text:string)=>string} [edit] */
  async function attempt(extra, edit = (text) => text, text = planned()) {
    const box = project({ [artifact]: text, ...extra });
    for (const target of ["acceptance", "scope", "units"])
      await box.send(`vouch confirm ${target}`);
    box.files.data.set(artifact, edit(text));
    await box.send("vouch review");
    const gate = (await box.audit.list()).find(
      (row) => row.type === "gate.opened",
    );
    return reason(await box.send(`vouch approve ${gate?.id}`));
  }
  t.plan(6);
  t.assert.match(
    await attempt({}, (text) => text.replace("AC-1: keep", "AC-1: drop")),
    /not applied: checkpoints acceptance$/,
  );
  t.assert.match(
    await attempt({ "vouch/rules.md": "# Rules without frontmatter\n" }),
    /not applied: rules vouch\/rules\.md/,
  );
  t.assert.match(
    await attempt({
      "vouch/rules.md": "---\nlanguage: ja\ncheckpoints: unit\n---\n",
    }),
    /not applied: checkpoints unit U1$/,
  );
  t.assert.match(
    await attempt(
      {},
      (text) => text,
      planned([["Unfilled", "Unassessed", "Undecided"]]),
    ),
    /not applied: plan /,
  );
  t.assert.match(
    await attempt({}, (text) => text, planned([["U1", "H", "required"]])),
    /not applied: checkpoints unit U1, design$/,
  );
  const designed = project({
    [artifact]: planned([["U1", "M", "required"]]),
    [design]: "---\nstatus: draft\n---\n# Design\n",
  });
  for (const target of ["acceptance", "scope", "units", "design"])
    await designed.send(`vouch confirm ${target}`);
  await designed.send("vouch review");
  const gate = (await designed.audit.list()).find(
    (row) => row.type === "gate.opened",
  );
  designed.files.data.set(
    design,
    "---\nstatus: draft\n---\n# Design changed\n",
  );
  t.assert.match(
    reason(await designed.send(`vouch approve ${gate?.id}`)),
    /not applied: checkpoints design$/,
  );
});

test("approval input needs a matching nonsynthetic gate and ordered times", async (t) => {
  const { send, audit, files } = project({ [artifact]: planned() });
  await send("vouch review", { at: "2026-09-29T00:00:10Z" });
  const [gate] = await audit.list();
  if (!gate) throw new Error("gate");
  t.plan(4);
  t.assert.match(
    reason(await send(`vouch approve evt_${"0".repeat(64)}`)),
    /^VOUCH-REVIEW-EVIDENCE: matching nonsynthetic gate/,
  );
  t.assert.match(
    reason(
      await send(`vouch approve ${gate.id}`, { at: "2026-09-29T00:00:09Z" }),
    ),
    /^VOUCH-REVIEW-EVIDENCE: valid ordered UTC timestamps/,
  );
  files.data.set(artifact, `${planned()}changed\n`);
  t.assert.match(
    reason(
      await send(`vouch approve ${gate.id}`, { at: "2026-09-29T00:00:11Z" }),
    ),
    /^VOUCH-REVIEW-EVIDENCE: revision/,
  );
  t.assert.equal((await audit.list()).length, 1);
});
