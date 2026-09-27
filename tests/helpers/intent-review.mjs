import { capturedPrompt, runHook, sandbox } from "./runtime.mjs";
export const intent = "260927-review";
export const artifact = `vouch/intents/${intent}/intent.md`;
export const audit = `vouch/intents/${intent}/audit/events.jsonl`;
export const draft =
  "---\nstatus: draft\n---\n# Synthetic review\n\nAC-1: preserve evidence.\n";
/** @param {import('node:test').TestContext} t @param {'claude'|'codex'} [harness] */
export async function reviewBox(t, harness = "claude") {
  const box = await sandbox(t);
  await box.write(artifact, draft);
  /** @param {string} prompt @param {string} [identity] */
  function fixture(prompt, identity = "synthetic-open") {
    const capture = capturedPrompt(harness);
    return {
      ...capture,
      synthetic: true,
      provenance: /** @type {const} */ ("synthetic"),
      payload: {
        ...capture.payload,
        cwd: box.root,
        hook_event_name: /** @type {const} */ ("UserPromptSubmit"),
        prompt,
        [harness === "claude" ? "prompt_id" : "turn_id"]: identity,
      },
    };
  }
  /** @param {string} prompt @param {string} [identity] @param {string} [instant] */
  const submit = (
    prompt,
    identity = "synthetic-open",
    instant = "2026-09-27T00:00:00.000Z",
  ) =>
    runHook("vouch-record-intent-review", fixture(prompt, identity), {
      root: box.root,
      intent,
      instant,
    });
  const rows = async () =>
    /** @type {import('../../core/hooks/lib/contracts.mjs').AuditEvent[]} */ (
      (await box.read(audit))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    );
  return { ...box, fixture, submit, rows };
}
