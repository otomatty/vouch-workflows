import { test } from "node:test";
import {
  claudeTokens,
  readTokens,
  sharedWaitIds,
} from "../../../core/hooks/lib/measure.mjs";

const tokens = (value: unknown) => readTokens(value);

test("readTokens keeps only a Claude-shaped usage object", (t) => {
  t.plan(12);
  t.assert.equal(tokens(null), undefined);
  t.assert.equal(tokens("usage"), undefined);
  t.assert.equal(tokens({}), undefined);
  t.assert.equal(tokens({ tokens: null }), undefined);
  t.assert.equal(tokens({ tokens: [] }), undefined);
  t.assert.equal(tokens({ tokens: { in: 1, out: 1, extra: 1 } }), undefined);
  t.assert.equal(tokens({ tokens: { in: 1.5, out: 1 } }), undefined);
  t.assert.equal(tokens({ tokens: { in: -1, out: 1 } }), undefined);
  t.assert.equal(tokens({ tokens: { in: 1, out: 1, cache: -1 } }), undefined);
  t.assert.equal(
    tokens({ tokens: { in: Number.MAX_SAFE_INTEGER + 1, out: 1 } }),
    undefined,
  );
  t.assert.deepEqual(tokens({ tokens: { in: 2, out: 3 } }), { in: 2, out: 3 });
  t.assert.deepEqual(tokens({ tokens: { in: 2, out: 3, cache: 4 } }), {
    in: 2,
    out: 3,
    cache: 4,
  });
});

test("claudeTokens copies usage for Claude and drops it for Codex", (t) => {
  const usage = { tokens: { in: 1, out: 2 } };
  t.plan(2);
  t.assert.deepEqual(claudeTokens("claude", usage), usage.tokens);
  t.assert.equal(claudeTokens("codex", usage), undefined);
});

test("sharedWaitIds names gate answers whose parent already has an intent.approved", (t) => {
  const events = [
    {
      id: "synthetic-approval",
      v: 1,
      type: "intent.approved",
      ts: "2026-09-30T00:00:00.000Z",
      actor: "human",
      intent: "260930-resume",
      source: "intent",
      parent: "gate-synthetic",
      wait_ms: 1,
      synthetic: true,
    },
    {
      id: "estimated-gate",
      v: 1,
      type: "gate.approved",
      ts: "2026-09-30T00:00:00.000Z",
      actor: "human",
      intent: "260930-resume",
      source: "intent",
      parent: "gate-1",
      wait_ms: 1,
      estimated: true,
    },
    {
      id: "approved",
      v: 1,
      type: "intent.approved",
      ts: "2026-09-30T00:00:02.000Z",
      actor: "human",
      intent: "260930-resume",
      source: "intent",
      parent: "gate-1",
      wait_ms: 4000,
    },
    {
      id: "shared-ok",
      v: 1,
      type: "gate.approved",
      ts: "2026-09-30T00:00:02.000Z",
      actor: "human",
      intent: "260930-resume",
      source: "intent",
      parent: "gate-1",
      wait_ms: 4000,
    },
    {
      id: "shared-no",
      v: 1,
      type: "gate.rejected",
      ts: "2026-09-30T00:00:02.000Z",
      actor: "human",
      intent: "260930-resume",
      source: "intent",
      parent: "gate-1",
      wait_ms: 4000,
      reason: "needs-work",
    },
    {
      id: "separate",
      v: 1,
      type: "gate.approved",
      ts: "2026-09-30T00:00:03.000Z",
      actor: "human",
      intent: "260930-resume",
      source: "pr",
      parent: "gate-2",
      wait_ms: 500,
    },
    {
      id: "no-parent",
      v: 1,
      type: "intent.created",
      ts: "2026-09-30T00:00:00.000Z",
      actor: "model",
      intent: "260930-resume",
      risk: "L",
    },
  ];
  t.plan(1);
  t.assert.deepEqual(
    sharedWaitIds(
      events as import("../../../core/hooks/lib/contracts.mjs").AuditEvent[],
    ),
    ["shared-ok", "shared-no"],
  );
});
