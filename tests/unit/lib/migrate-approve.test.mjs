import { test } from "node:test";
import { createIntentAuditStore } from "../../../core/hooks/lib/audit.mjs";
import { newId, sha256Hex } from "../../../core/hooks/lib/clock.mjs";
import { approveMigration } from "../../../core/hooks/lib/migrate-approve.mjs";
import { home, intent } from "../../helpers/migrate.mjs";
import { validator } from "../../helpers/registry.mjs";
import { memoryFiles } from "../../helpers/runtime.mjs";

const validate = validator("audit-event");
const brief = `---
status: draft
source: aidlc/spaces/default/intents/250615-widget
intent: ${intent}
files: 26
---

# 移行レポート: ${intent}
`;
const digest = sha256Hex(Buffer.from(brief));

/** @param {Record<string,string>} [initial] */
function prompt(initial = { [`${home}/migration.md`]: brief }) {
  const files = memoryFiles(initial);
  /** @param {string} text @param {{harness?:'claude'|'codex',submission?:string|null,scope?:string|null,instant?:string}} [shape] */
  const submit = (text, shape = {}) => {
    const harness = shape.harness ?? "claude";
    const field = harness === "claude" ? "prompt_id" : "turn_id";
    const scope = shape.scope === undefined ? intent : shape.scope;
    return approveMigration(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "s-1",
        cwd: "/project",
        prompt: text,
        ...(shape.submission === null
          ? {}
          : { [field]: shape.submission ?? "p-1" }),
      },
      {
        projectRoot: "/project",
        harness,
        ...(scope ? { intent: scope } : {}),
        generation: "test",
        now: () => shape.instant ?? "2026-10-01T00:00:05Z",
        newId,
        readText: (path) => files.readText(path),
        locate: (path) => files.locate(path),
        audit: createIntentAuditStore(files, intent),
      },
    );
  };
  return { files, submit };
}

test("a person's approval of the current report records migration.completed and is not forwarded", async (t) => {
  const { submit } = prompt();
  const result = await submit(`vouch migrate approve ${digest}`);
  const event = result?.events?.[0];
  t.plan(4);
  t.assert.equal(result?.decision, "deny");
  t.assert.match(
    result?.reason ?? "",
    /^VOUCH-MIGRATE-RECORDED: evt_[a-f0-9]{64}; migration\.md [a-f0-9]{64}; not an Intent approval$/,
  );
  t.assert.equal(validate(event), true, JSON.stringify(validate.errors));
  t.assert.deepEqual(event, {
    id: newId(intent, JSON.stringify(["migration.completed", intent, digest])),
    v: 1,
    type: "migration.completed",
    ts: "2026-10-01T00:00:05Z",
    actor: "human",
    harness: "claude",
    intent,
    session: "s-1",
    files_migrated: 26,
    revision: { path: "migration.md", sha256: digest },
    submission: {
      hook_event_name: "UserPromptSubmit",
      field: "prompt_id",
      id: "p-1",
      prompt_sha256: sha256Hex(Buffer.from(`vouch migrate approve ${digest}`)),
    },
  });
});

test("other prompts and an unconfigured Intent are not this recorder's input", async (t) => {
  const { submit } = prompt();
  t.plan(5);
  t.assert.equal(await submit("please migrate"), null);
  t.assert.equal(await submit("vouch migrate"), null);
  t.assert.equal(await submit("vouch migrated approve x"), null);
  t.assert.equal(
    await submit(`vouch migrate approve ${digest}`, { scope: null }),
    null,
  );
  t.assert.equal(
    await approveMigration(
      {
        hook_event_name: "Stop",
        session_id: "s",
        cwd: "/",
        stop_hook_active: false,
      },
      /** @type {never} */ ({ intent }),
    ),
    null,
  );
});

test("malformed, unidentified, missing, approved and stale reports are refused without a record", async (t) => {
  const approved = brief.replace("status: draft", "status: approved");
  const cases = [
    [prompt(), `vouch migrate approve`, {}, "VOUCH-MIGRATE-COMMAND"],
    [
      prompt(),
      `vouch migrate approve ${digest.toUpperCase()}`,
      {},
      "VOUCH-MIGRATE-COMMAND",
    ],
    [prompt(), `vouch migrate approve  ${digest}`, {}, "VOUCH-MIGRATE-COMMAND"],
    [
      prompt(),
      `vouch migrate approve ${digest}`,
      { submission: null },
      "VOUCH-MIGRATE-IDENTITY",
    ],
    [prompt({}), `vouch migrate approve ${digest}`, {}, "VOUCH-MIGRATE-BRIEF"],
    [
      prompt({ [`${home}/migration.md`]: approved }),
      `vouch migrate approve ${sha256Hex(Buffer.from(approved))}`,
      {},
      "VOUCH-MIGRATE-BRIEF",
    ],
    [
      prompt({ [`${home}/migration.md`]: brief.replace("files: 26\n", "") }),
      `vouch migrate approve ${sha256Hex(Buffer.from(brief.replace("files: 26\n", "")))}`,
      {},
      "VOUCH-MIGRATE-BRIEF",
    ],
    [
      prompt(),
      `vouch migrate approve ${"0".repeat(64)}`,
      {},
      "VOUCH-MIGRATE-CHANGED",
    ],
  ];
  t.plan(cases.length * 2);
  for (const [project, text, shape, code] of cases) {
    const { submit } = /** @type {ReturnType<typeof prompt>} */ (project);
    const result = await submit(
      /** @type {string} */ (text),
      /** @type {{}} */ (shape),
    );
    t.assert.equal(result?.decision, "deny", String(code));
    t.assert.deepEqual(
      [result?.reason?.split(":")[0], result?.events],
      [code, undefined],
      String(text),
    );
  }
});

test("a resent approval keeps its first record and time; Codex binds the turn", async (t) => {
  const { files, submit } = prompt();
  const first = await submit(`vouch migrate approve ${digest}`);
  if (first?.events)
    await createIntentAuditStore(files, intent).append(first.events);
  const again = await submit(`vouch migrate approve ${digest}`, {
    instant: "2026-10-01T09:00:00Z",
  });
  const codex = await prompt().submit(`vouch migrate approve ${digest}`, {
    harness: "codex",
  });
  t.plan(3);
  t.assert.deepEqual(again?.events, first?.events);
  t.assert.equal(codex?.events?.[0]?.submission?.field, "turn_id");
  t.assert.equal(validate(codex?.events?.[0]), true);
});
