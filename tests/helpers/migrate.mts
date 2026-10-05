import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

// v2 records for the migration tests (docs/development/migrate.md). The state files, the audit sample
// and the artifacts are the unchanged reference fixtures; everything named `hand` is a hand-made input.
const reference = "docs/aidlc-v2-reference";
const fixtures = `${reference}/tests/fixtures`;
export const space = "aidlc/spaces/default";
export const record = `${space}/intents/250615-widget`;
export const intent = "250615-widget";
/** The command words naming the record: `<space> <YYMMDD-label>`. */
export const where = ["default", "250615-widget"] as const;
export const home = `vouch/intents/${intent}`;
export const archive = (path: string) => `vouch/archive/aidlc-v2/${path}`;

/** The 15 progress fixtures, in code-unit order. */
export const states = readdirSync(fixtures)
  .filter((name) => /^state-.+\.md$/.test(name))
  .sort();

/** Hand-made second shard: converted, skipped, estimated, untyped and decision blocks. */
export const handShard = `# AI-DLC Audit Log

## Workflow Started
**Timestamp**: 2025-06-15T10:31:00Z
**Event**: WORKFLOW_STARTED
**Scope**: feature
**Request**: Add a widget

---

## Stage Started
**Timestamp**: 2025-06-15T10:40:00Z
**Event**: STAGE_STARTED
**Stage**: intent-capture
**Agent**: aidlc-product-agent

---

## Stage Started
**Timestamp**: 2025-06-15T11:10:00Z
**Event**: STAGE_STARTED
**Stage**: market-research
**Agent**: aidlc-product-agent

---

## Gate Approved
**Timestamp**: 2025-06-15T12:00:00Z
**Event**: GATE_APPROVED
**Stage**: approval-handoff
**User Input**: Approve. Ship the cart first.

---

## Stage Completed
**Timestamp**: 2025-06-15T12:00:01Z
**Event**: STAGE_COMPLETED
**Stage**: approval-handoff
**Details**: Ideation done
**Artifacts**: initiative-brief.md

---

## Stage Completed
**Timestamp**: 2025-06-16T09:00:00Z
**Event**: STAGE_COMPLETED
**Stage**: delivery-planning
**Details**: Bolt plan approved
**Artifacts**: bolt-plan.md

---

## Rule Learned
**Timestamp**: 2025-06-16T09:05:00Z
**Event**: RULE_LEARNED
**Stage**: delivery-planning
**Destination**: team.md

---

## Stage Started
**Event**: STAGE_STARTED
**Stage**: functional-design

---

## Error: Parse failure
**Timestamp**: 2025-06-16T09:30:00Z
**Severity**: Low
**Type**: Parse error
**Description**: state line unreadable
**Resolution**: retried

---

## Requirements Analysis Complete
**Timestamp**: 2025-06-16T10:00:00Z
**Event**: Requirements Analysis Complete

---
`;

const handReview = `# Code Summary — todo-core

- src/App.tsx

## Review

Reviewer: READY. No findings.
`;

const handQuestions = `# Requirements Analysis Questions

## Q1: Persistence
A. Local storage
B. None
X. Other (please specify)

[Answer]: B — client-side only, the user said so.
`;

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);

/** Source path → bytes of one v2 record and its space, for the state fixture given. */
export function v2Files(
  state: string = "state-construction.md",
): Record<string, Buffer> {
  const read = (path: string) => readFileSync(path);
  const text = (value: string) => Buffer.from(value);
  return {
    [`${record}/aidlc-state.md`]: read(`${fixtures}/${state}`),
    [`${record}/audit/host-clone.md`]: read(`${fixtures}/audit-sample.md`),
    [`${record}/audit/host-other.md`]: text(handShard),
    [`${record}/ideation/rough-mockups/wireframe.png`]: png,
    [`${record}/inception/requirements-analysis/requirements.md`]: read(
      `${fixtures}/inception-artifacts/requirements.md`,
    ),
    [`${record}/inception/requirements-analysis/requirements-analysis-questions.md`]:
      text(handQuestions),
    [`${record}/inception/requirements-analysis/memory.md`]: text(
      "# Diary\n\n- noted\n",
    ),
    ...Object.fromEntries(
      [
        "components.md",
        "component-methods.md",
        "component-dependency.md",
        "services.md",
      ].map((name) => [
        `${record}/inception/domain-design/${name}`,
        read(`${fixtures}/inception-artifacts/${name}`),
      ]),
    ),
    ...Object.fromEntries(
      ["unit-of-work.md", "unit-of-work-story-map.md"].map((name) => [
        `${record}/inception/units-generation/${name}`,
        read(`${fixtures}/inception-artifacts/${name}`),
      ]),
    ),
    [`${record}/construction/todo-core/functional-design/functional-spec.md`]:
      read(`${fixtures}/construction-artifacts/functional-design.md`),
    [`${record}/construction/todo-core/code-generation/code-summary.md`]:
      text(handReview),
    [`${record}/operation/deployment-pipeline/cd-config.md`]:
      text("# CD config\n"),
    [`${record}/runtime-graph.json`]: text("{}\n"),
    [`${record}/notes/extra.md`]: text("# Extra\n"),
    ...Object.fromEntries(
      [
        "architecture-overview.md",
        "codebase-analysis.md",
        "integration-points.md",
        "reverse-engineering-timestamp.md",
        "technology-stack.md",
      ].map((name) => [
        `${space}/codekb/widget-app/${name}`,
        read(`${fixtures}/re-artifacts/${name}`),
      ]),
    ),
    [`${space}/memory/team.md`]: read(`${reference}/core/memory/team.md`),
    [`${space}/memory/org.md`]: read(`${reference}/core/memory/org.md`),
    [`${space}/memory/phases/inception.md`]: read(
      `${reference}/core/memory/phases/inception.md`,
    ),
  };
}

/** A record with only the state fixture and the audit sample. */
export const stateRecord = (state: string): Record<string, Buffer> => ({
  [`${record}/aidlc-state.md`]: readFileSync(`${fixtures}/${state}`),
  [`${record}/audit/host-clone.md`]: readFileSync(
    `${fixtures}/audit-sample.md`,
  ),
});

/** Write the files below a root. */
export async function writeTree(
  root: string,
  files: Record<string, Buffer | string>,
) {
  for (const [path, bytes] of Object.entries(files)) {
    const target = resolve(root, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, bytes);
  }
}

/** Every file below a directory with its SHA-256, root-relative and "/"-separated. */
export async function digests(
  root: string,
  directory: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(join(root, directory), {
      recursive: true,
      withFileTypes: true,
    });
  } catch {
    return result;
  }
  for (const entry of entries.filter((item) => item.isFile())) {
    const path = join(entry.parentPath, entry.name);
    result[relative(root, path).replaceAll("\\", "/")] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  }
  return Object.fromEntries(Object.entries(result).sort());
}

export const environment = {
  projectRoot: "/project",
  installationRoot: ".claude",
  nodeVersion: "22.19.0",
};
export const git = { ok: true, detail: "git" };
export const ports = (...args: string[]) => ({
  args,
  now: () => "2026-10-01T00:00:00.000Z",
});
