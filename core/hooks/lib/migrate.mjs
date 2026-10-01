import approvals from "../../registry/approval.json" with { type: "json" };
import migration from "../../registry/migration.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import { createAuditStore, intentHome } from "./audit.mjs";
import { now, sha256Hex } from "./clock.mjs";
import { readArgs } from "./env.mjs";
import { renderBrief } from "./migrate-brief.mjs";
import {
  bytesAt,
  findConflicts,
  listed,
  observeArtifacts,
  readSources,
  verifyCopies,
} from "./migrate-files.mjs";
import { expectedArtifacts, readCodekb, routeFile } from "./migrate-plan.mjs";
import { readLanguage } from "./position.mjs";
import { convertAudit, readShard } from "./v2-audit.mjs";
import { observeProgress, readState } from "./v2-state.mjs";

// The mechanical part of /vouch migrate (docs/development/migrate.md). It reads, copies and records;
// it never writes the destination artifacts, extracts decisions, integrates rules or approves.

/** @param {string} id @param {boolean} ok @param {string} detail @returns {import('./runtime-contracts.mjs').DoctorCheck} */
const check = (id, ok, detail) => ({ id, ok, detail });

/** @type {import('./migration-contracts.mjs').RunMigrate} */
export async function runMigrate(
  files,
  _environment,
  _git,
  ports = { args: readArgs(), now },
) {
  // Words only, so the write guard lets an installed copy run: `plan <space> <YYMMDD-label> [<intent>]`.
  const [operation = "", space = "", label = "", name, ...rest] = ports.args;
  const source = `aidlc/spaces/${space}/intents/${label}`;
  const match = new RegExp(migration.source.record).exec(source);
  const intent = name ?? label;
  /** @type {string|null} */ let home = null;
  try {
    home = intentHome(intent);
  } catch {}
  if (
    !migration.operations.includes(operation) ||
    !match ||
    rest.length ||
    !home
  )
    return {
      v: 1,
      ok: false,
      checks: [
        check(
          "MIGRATE-ARGS",
          false,
          `usage: ${migration.operations.join(" | ")} <space> <YYMMDD-label> [<intent>] for aidlc/spaces/<space>/intents/<YYMMDD-label>`,
        ),
      ],
    };
  const checks = [
    check("MIGRATE-ARGS", true, `${operation} ${source} → ${home}`),
  ];
  const read = await readSources(files, source, `aidlc/spaces/${space}`);
  if (read === null) {
    checks.push(
      check("MIGRATE-SOURCE", false, `${source}: no record directory`),
    );
    return { v: 1, ok: false, checks };
  }
  const { sources, refused, recorded } = read;
  checks.push(
    check(
      "MIGRATE-SOURCE",
      true,
      `${recorded} record files and ${sources.length + refused.length - recorded} space files`,
    ),
  );
  const inRecord = sources.filter((file) => file.scope === "record");
  const stateFile = inRecord.find(
    (file) => file.origin === migration.source.state,
  );
  const state = readState(stateFile ? (stateFile.text ?? "") : null);
  const progress = observeProgress(state.rows);
  const shards = inRecord.filter((file) =>
    new RegExp(migration.audit.shard).test(file.origin),
  );
  const audit = convertAudit(
    shards.flatMap((file) =>
      file.text === null ? [] : readShard(file.path, file.text),
    ),
    intent,
    progress,
  );
  const auditProblems = [
    ...shards
      .filter((file) => file.text === null)
      .map((file) => `${file.path}: invalid UTF-8`),
    ...audit.problems,
  ];
  const stamp = state.fields[migration.affirmation.state];
  const affirmed = audit.events.find(
    (event) => event.original_type === migration.affirmation.event,
  );
  const affirmation = stamp
    ? `${migration.source.state}: ${migration.affirmation.state} ${stamp}`
    : affirmed
      ? `${affirmed.source_path}: ${migration.affirmation.event} ${affirmed.id}`
      : null;
  const migrated = sources.map((file) => ({
    path: file.path,
    origin: file.origin,
    bytes: file.bytes.length,
    sha256: sha256Hex(file.bytes),
    archive: `${migration.archive}/${file.path}`,
    ...routeFile(file.scope, file.origin, file.text, affirmation !== null),
  }));
  const artifacts = await observeArtifacts(
    files,
    home,
    expectedArtifacts(migrated.map((file) => file.to)),
  );
  const briefPath = `${home}/${migration.brief}`;
  const current = await bytesAt(files, briefPath);
  /** @type {import('./migration-contracts.mjs').MigrationPayload} */
  const payload = {
    source,
    intent,
    language: readLanguage(await files.readText(approvals.rules)),
    files: migrated,
    progress,
    units: [
      ...new Set(
        state.rows.flatMap((row) => (row.unit === null ? [] : [row.unit])),
      ),
    ],
    audit: {
      blocks: audit.events.length,
      converted: audit.events.filter(
        (event) => !event.type.startsWith("legacy."),
      ).length,
      legacy: audit.events.filter((event) => event.type.startsWith("legacy."))
        .length,
      estimated: audit.events.filter((event) => event.estimated).length,
      types: audit.types,
    },
    decisions: audit.decisions,
    affirmation,
    codekb: readCodekb(
      sources
        .filter((file) => file.scope === "space")
        .map((file) => [file.origin, file.text]),
    ),
    artifacts,
    brief: { path: briefPath, sha256: current ? sha256Hex(current) : null },
  };
  const brief = Buffer.from(renderBrief(payload), "utf8");

  // Every target is absent or identical; anything else refuses the whole apply before a write.
  const conflicts = await findConflicts(files, {
    home,
    migrated,
    events: audit.events,
    artifacts,
    current,
    brief,
  });
  checks.push(
    check(
      "MIGRATE-FILES",
      refused.length === 0,
      refused.length
        ? `links, other nodes or unreadable files: ${listed(refused)}`
        : `${sources.length} regular files`,
    ),
    check(
      "MIGRATE-STATE",
      state.problems.length === 0,
      state.problems.join("; ") || `${state.rows.length} checkboxes`,
    ),
    check(
      "MIGRATE-AUDIT",
      auditProblems.length === 0,
      auditProblems.join("; ") ||
        `${shards.length} shards, ${audit.events.length} blocks`,
    ),
    check(
      "MIGRATE-TARGET",
      conflicts.length === 0,
      conflicts.length
        ? `different existing content: ${listed(conflicts)}`
        : `${home} and ${migration.archive}`,
    ),
  );
  const ready = checks.every((item) => item.ok);
  if (operation === "plan" || !ready)
    return { v: 1, ok: ready, checks, migration: payload };

  // Archive, then the audit, then the report: a rerun skips what was written and writes the rest.
  let archived = 0;
  for (const file of sources)
    if (
      await files.createBytes(`${migration.archive}/${file.path}`, file.bytes)
    )
      archived++;
  const appended = audit.events.length
    ? await createAuditStore(files, `${home}/${documents.audit}`).append(
        audit.events,
      )
    : "none";
  const written = await files.createBytes(briefPath, brief);
  const mismatched = await verifyCopies(files, migrated);
  payload.writes = {
    archived,
    unchanged: sources.length - archived,
    audit: appended,
    brief: written ? "written" : "unchanged",
  };
  payload.brief.sha256 = sha256Hex(brief);
  checks.push(
    check(
      "MIGRATE-WRITE",
      true,
      `archived ${archived}, unchanged ${sources.length - archived}, audit ${appended}, report ${payload.writes.brief}`,
    ),
    check(
      "MIGRATE-VERIFY",
      mismatched.length === 0,
      mismatched.length
        ? `source or archive differs: ${listed(mismatched)}`
        : `${migrated.length} source files unchanged and archived byte for byte`,
    ),
  );
  return { v: 1, ok: mismatched.length === 0, checks, migration: payload };
}
