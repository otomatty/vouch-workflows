import { test } from "node:test";
import { createIntentAuditStore } from "../../../core/hooks/lib/audit.mjs";
import { newId } from "../../../core/hooks/lib/clock.mjs";
import { checkKnowledge } from "../../../core/hooks/lib/knowledge-check.mjs";
import {
  artifact,
  head,
  knowledgeFiles,
  question,
} from "../../helpers/knowledge.mjs";
import { memoryFiles } from "../../helpers/runtime.mjs";

function project() {
  const intent = "knowledge-test";
  const base = `vouch/intents/${intent}/`;
  const files = memoryFiles({
    ...knowledgeFiles(),
    [`${base}intent.md`]: artifact,
    [`${base}decisions.md`]: question + artifact,
  });
  const audit = createIntentAuditStore(files, intent);
  const ctx = {
    ...files,
    projectRoot: "/project",
    intent,
    harness: /** @type {const} */ ("claude"),
    generation: "ignored",
    now: () => "2026-09-27T12:00:00Z",
    newId,
    audit,
  };
  let count = 0;
  /** @param {string} prompt @param {string} [identity] */
  const input = (prompt, identity = `submission-${++count}`) => ({
    hook_event_name: /** @type {const} */ ("UserPromptSubmit"),
    cwd: "/project",
    session_id: "session",
    prompt,
    prompt_id: identity,
  });
  /** @param {string} prompt @param {string} [identity] */
  const send = async (prompt, identity) => {
    const result = await checkKnowledge(
      input(prompt, identity),
      ctx,
      async () => head,
    );
    if (result?.events) await audit.append(result.events);
    return result;
  };
  return { files, ctx, input, send, audit, base };
}
test("knowledge dispatch ignores unrelated input and refuses malformed commands or missing identity", async (t) => {
  const box = project();
  t.assert.equal(await box.send("yes"), null);
  t.assert.equal(
    await checkKnowledge(box.input("vouch knowledge check"), {
      ...box.ctx,
      intent: "",
    }),
    null,
  );
  t.assert.equal(
    await checkKnowledge(
      {
        hook_event_name: "SessionStart",
        session_id: "s",
        cwd: "/project",
        source: "startup",
      },
      box.ctx,
    ),
    null,
  );
  for (const prompt of [
    "vouch knowledge",
    "vouch knowledge checks",
    "vouch citations check ",
    "vouch citations check\n",
  ]) {
    t.assert.match((await box.send(prompt))?.reason ?? "", /COMMAND/);
  }
  const input = box.input("vouch knowledge check");
  const { prompt_id: _identity, ...missing } = input;
  t.assert.match(
    (await checkKnowledge(missing, box.ctx))?.reason ?? "",
    /COMMAND/,
  );
});
test("freshness and refresh bind observed bytes and retain replay measurements without reusing stale success", async (t) => {
  const box = project();
  const first = await box.send("vouch knowledge refresh", "refresh");
  const replay = await box.send("vouch knowledge refresh", "refresh");
  t.assert.deepEqual(replay, first);
  t.assert.equal(first?.events?.[1]?.type, "knowledge.refreshed");
  t.assert.match(
    first?.events?.[0]?.type === "hook.check"
      ? (first.events[0].knowledge?.sha256 ?? "")
      : "",
    /^[a-f0-9]{64}$/,
  );
  box.ctx.now = () => "2026-09-28T12:00:00Z";
  t.assert.deepEqual(
    await box.send("vouch knowledge refresh", "refresh"),
    first,
  );
  box.files.data.set("vouch/rules.md", "changed");
  await t.assert.rejects(
    box.send("vouch knowledge refresh", "refresh"),
    /AUDIT-CONFLICT/,
  );
  const bad = await box.send("vouch knowledge refresh");
  t.assert.equal(
    bad?.events?.some((e) => e.type === "knowledge.refreshed"),
    false,
  );
  t.assert.equal(bad?.events?.[1]?.type, "hook.denied");
  const absentHead = await checkKnowledge(
    box.input("vouch knowledge check"),
    box.ctx,
    async () => null,
  );
  t.assert.match(absentHead?.reason ?? "", /stale generation/);
  const empty = project();
  empty.files.data.delete("vouch/knowledge/index.json");
  t.assert.match(
    (await empty.send("vouch knowledge check"))?.reason ?? "",
    /missing/,
  );
});
test("citation command checks every present artifact and both required files", async (t) => {
  const box = project();
  for (const name of ["design.md", "build-log.md", "review.md"])
    box.files.data.set(box.base + name, artifact);
  const first = await box.send("vouch citations check", "citations");
  t.assert.match(first?.reason ?? "", /passed/);
  box.files.data.set(`${box.base}design.md`, "No references");
  await t.assert.rejects(
    box.send("vouch citations check", "citations"),
    /AUDIT-CONFLICT/,
  );
  t.assert.match(
    (await box.send("vouch citations check"))?.reason ?? "",
    /design.md: missing references/,
  );
  box.files.data.delete(`${box.base}intent.md`);
  box.files.data.delete(`${box.base}decisions.md`);
  t.assert.match(
    (await box.send("vouch citations check"))?.reason ?? "",
    /missing artifact: intent.md.*missing artifact: decisions.md/,
  );
});
test("synthetic history and invalid clocks cannot report recorded checks", async (t) => {
  const box = project();
  const input = box.input("vouch knowledge check");
  const first = await checkKnowledge(input, box.ctx, async () => head);
  if (!first?.events?.[0]) throw new Error("record required");
  await box.audit.append([{ ...first.events[0], synthetic: true }]);
  t.assert.match(
    (await checkKnowledge(input, box.ctx, async () => head))?.reason ?? "",
    /synthetic/,
  );
  const clock = project();
  clock.ctx.now = () => "not a date";
  await t.assert.rejects(
    checkKnowledge(
      clock.input("vouch knowledge check"),
      clock.ctx,
      async () => head,
    ),
    /CLOCK/,
  );
});
