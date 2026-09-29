import { deriveFixture } from "./fixtures.mjs";
import { tree } from "./packaging.mjs";
import { readJson } from "./registry.mjs";
import { runHook, sandbox } from "./runtime.mjs";

// Linux captures inventoried for artifact-guard; see docs/development/write-guard.md.
const captures = {
  claude: {
    Write:
      "tests/fixtures/harness/claude/2.1.283/linux/print/PreToolUse.Write.json",
    Edit: "tests/fixtures/harness/claude/2.1.283/linux/print/PreToolUse.Edit.json",
    Bash: "tests/fixtures/harness/claude/2.1.283/linux/print/PreToolUse.Bash.json",
    Agent:
      "tests/fixtures/harness/claude/2.1.283/linux/print/PreToolUse.Agent.json",
  },
  codex: {
    apply_patch:
      "tests/fixtures/harness/codex/0.153.4/linux/exec/PreToolUse.apply_patch.json",
    Bash: "tests/fixtures/harness/codex/0.153.4/linux/exec/PreToolUse.Bash.json",
  },
};

export const intent = "260929-guard";
export const audit = `vouch/intents/${intent}/audit/events.jsonl`;
export const artifact = `vouch/intents/${intent}/intent.md`;
export const approved = "vouch/intents/260929-done/intent.md";
export const draft =
  "---\nstatus: draft\n---\n# Guarded draft\n\nAC-1: keep it.\n";
export const record = `${JSON.stringify({
  id: "evt_guard",
  v: 1,
  type: "session.started",
  ts: "2026-09-29T00:00:00.000Z",
  actor: "hook",
  harness: "claude",
  intent,
  session: "guard-session",
})}\n`;

/**
 * A synthetic derivation of an inventoried Linux PreToolUse capture.
 * @param {'claude'|'codex'} harness @param {string} tool
 * @param {string} cwd @param {Record<string,unknown>} toolInput
 * @returns {import('../../core/hooks/lib/contracts.mjs').HarnessFixture}
 */
export function toolFixture(harness, tool, cwd, toolInput) {
  /** @type {Record<string,string>} */
  const paths = captures[harness];
  const path = paths[tool];
  if (!path) throw new Error(`TEST-7: no ${harness} ${tool} capture`);
  return deriveFixture(readJson(path), { cwd, tool_input: toolInput });
}

/** A project with an audit log, a draft and an approved Intent.
 * @param {import('node:test').TestContext} t */
export async function guardBox(t) {
  const box = await sandbox(t);
  await box.write(audit, record);
  await box.write(artifact, draft);
  await box.write(approved, draft.replace("draft", "approved"));
  /**
   * @param {'claude'|'codex'} harness @param {string} tool
   * @param {Record<string,unknown>} toolInput
   * @param {{cwd?:string,intent?:string}} [options]
   */
  const guard = (harness, tool, toolInput, options = {}) =>
    runHook(
      "vouch-guard-writes",
      toolFixture(harness, tool, options.cwd ?? box.root, toolInput),
      { root: box.root, intent: options.intent ?? "" },
    );
  return { ...box, guard, snapshot: () => tree(box.root) };
}
