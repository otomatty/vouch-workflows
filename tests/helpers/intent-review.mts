import { capturedPrompt, runHook, sandbox } from "./runtime.mjs";
export const intent = "260927-review";
export const artifact = `vouch/intents/${intent}/intent.md`;
export const audit = `vouch/intents/${intent}/audit/events.jsonl`;
export const draft =
  "---\nstatus: draft\n---\n# Synthetic review\n\nAC-1: preserve evidence.\n";
export async function reviewBox(
  t: import("node:test").TestContext,
  harness: "claude" | "codex" = "claude",
) {
  const box = await sandbox(t);
  await box.write(artifact, draft);
  function fixture(prompt: string, identity: string = "synthetic-open") {
    const capture = capturedPrompt(harness);
    return {
      ...capture,
      synthetic: true,
      provenance: "synthetic" as const,
      payload: {
        ...capture.payload,
        cwd: box.root,
        hook_event_name: "UserPromptSubmit" as const,
        prompt,
        [harness === "claude" ? "prompt_id" : "turn_id"]: identity,
      },
    };
  }
  const submit = (
    prompt: string,
    identity: string = "synthetic-open",
    instant: string = "2026-09-27T00:00:00.000Z",
  ) =>
    runHook("vouch-record-intent-review", fixture(prompt, identity), {
      root: box.root,
      intent,
      instant,
    });
  const rows = async () =>
    (await box.read(audit))
      .trim()
      .split("\n")
      .map((line) =>
        JSON.parse(line),
      ) as import("../../core/hooks/lib/contracts.mjs").AuditEvent[];
  return { ...box, fixture, submit, rows };
}

/** Plan rows: Unit ID, risk cell and design cell as an author writes them. */
const lowPlan = [["U1", "L: wording only", "not-required: no contract"]];

/** A synthetic draft with every intent section and a plan table in the registry grammar. */
export function planned(
  rows: string[][] = lowPlan,
  acceptance: string = "AC-1: keep evidence.",
) {
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

/** A review box holding a planned draft, with helpers that submit explicit inputs. Each identity is a distinct synthetic submission derived from the versioned capture. */
export async function approvalBox(
  t: import("node:test").TestContext,
  harness: "claude" | "codex" = "claude",
  text: string = planned(),
) {
  const box = await reviewBox(t, harness);
  await box.write(artifact, text);
  let count = 0;
  const send = (prompt: string, instant?: string) =>
    box.submit(prompt, `synthetic-${++count}`, instant);
  const confirm = (target: string, instant?: string) =>
    send(`vouch confirm ${target}`, instant);
  /** Confirm each target, open a gate and approve it; returns the approval result. */
  async function approveAfter(targets: string[] = topics) {
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

/** A synthetic design.md with every design section and a units table of Unit rows. @param rows Unit ID and design decision. */
export function designed(
  rows: string[][] = [["U1", "Keep the parser."]],
  ideal: string = "Ideal: one parser.",
) {
  const sections = {
    summary: "## Summary\n\nOne parser change.\n",
    ideal: `## Ideal\n\n${ideal}\n`,
    alternatives: "## Alternatives\n\nDo nothing: rejected.\n",
    diagrams: "## Diagrams\n\nComponents diff.\n",
    contract: "## Contract\n\nParser input type.\n",
    threats: "## Threats\n\nNot applicable below H.\n",
    units: [
      "## Units",
      "",
      "| Unit | Risk | Design | Contract commit | Measure |",
      "| --- | --- | --- | --- | --- |",
      ...rows.map(([id, decision]) => `| ${id} | M | ${decision} | c1 | - |`),
      "",
    ].join("\n"),
    references: "## References\n\nsrc/app.js:1@test\n",
  };
  return `---\nstatus: draft\n---\n# Synthetic design\n\n${Object.entries(
    sections,
  )
    .map(([id, body]) => `<!-- sec:${id} -->\n${body}`)
    .join("\n")}`;
}
