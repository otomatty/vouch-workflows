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

/** Plan rows: Unit ID, risk cell and design cell as an author writes them. */
const lowPlan = [["U1", "L: wording only", "not-required: no contract"]];

/**
 * A synthetic draft with every intent section and a plan table in the registry grammar.
 * @param {string[][]} [rows] @param {string} [acceptance]
 */
export function planned(rows = lowPlan, acceptance = "AC-1: keep evidence.") {
  const sections = {
    summary: "## Summary\n\nOne behavior change.\n",
    acceptance: `## Acceptance\n\n${acceptance}\n`,
    scope: "## Scope\n\nMinimum change; no refactor.\n",
    analysis: "## Analysis\n\nObserved at src/app.js:1@test.\n",
    plan: [
      "## Plan",
      "",
      "| Unit | ACs | Scope | Risk | Design |",
      "| --- | --- | --- | --- | --- |",
      ...rows.map(
        ([id, risk, design]) => `| ${id} | AC-1 | src | ${risk} | ${design} |`,
      ),
      "",
    ].join("\n"),
    verification: "## Verification\n\nAC-1 by unit test.\n",
    diagrams: "## Diagrams\n\nNot applicable: synthetic.\n",
    checkpoints: "## Checkpoints\n\nConfirmed through vouch confirm.\n",
    references: "## References\n\nsrc/app.js:1@test\n",
  };
  return `---\nstatus: draft\n---\n# Synthetic plan\n\n${Object.entries(
    sections,
  )
    .map(([id, body]) => `<!-- sec:${id} -->\n${body}`)
    .join("\n")}`;
}

/** Topic checkpoints of a plan without Design, in the default mode. */
export const topics = ["acceptance", "scope", "units"];

/**
 * A review box holding a planned draft, with helpers that submit explicit inputs.
 * Each identity is a distinct synthetic submission derived from the versioned capture.
 * @param {import('node:test').TestContext} t @param {'claude'|'codex'} [harness]
 * @param {string} [text]
 */
export async function approvalBox(t, harness = "claude", text = planned()) {
  const box = await reviewBox(t, harness);
  await box.write(artifact, text);
  let count = 0;
  /** @param {string} prompt @param {string} [instant] */
  const send = (prompt, instant) =>
    box.submit(prompt, `synthetic-${++count}`, instant);
  /** @param {string} target @param {string} [instant] */
  const confirm = (target, instant) => send(`vouch confirm ${target}`, instant);
  /** Confirm each target, open a gate and approve it; returns the approval result. */
  async function approveAfter(/** @type {string[]} */ targets = topics) {
    for (const target of targets) confirm(target);
    send("vouch review");
    const gate = (await box.rows()).findLast(
      (row) => row.type === "gate.opened",
    );
    if (!gate) throw Error("no gate");
    return {
      gate,
      result: send(`vouch approve ${gate.id}`, "2026-09-27T00:00:03Z"),
    };
  }
  return { ...box, send, confirm, approveAfter };
}
