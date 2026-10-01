import migration from "../../registry/migration.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import workflow from "../../registry/workflow.json" with { type: "json" };

// The migration report (docs/development/migrate.md): a Review Brief generated only from the
// stable plan, so the same source always renders the same bytes. Writes, the current digest and
// the observed artifacts are never part of it.

/** One table cell; source text cannot open code spans, cells or lines. @param {unknown} value */
const cell = (value) =>
  String(value)
    .replace(/\r?\n|\r/g, " ")
    .replaceAll("`", "'")
    .replaceAll("|", "\\|")
    .trim();
/** @param {unknown} value */
const code = (value) => `\`${cell(value)}\``;
/** @param {string[]} head @param {unknown[][]} rows @param {string} none */
const table = (head, rows, none) =>
  rows.length === 0
    ? none
    : [
        `| ${head.join(" | ")} |`,
        `| ${head.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.join(" | ")} |`),
      ].join("\n");
/** @param {string} template @param {Record<string,number>} values */
const fill = (template, values) =>
  template.replace(/\{([a-z]+)\}/g, (_, key) => String(values[key] ?? ""));

/** @type {import('./migration-contracts.mjs').RenderBrief} */
export function renderBrief(payload) {
  const labels = migration.labels[payload.language];
  const notes = /** @type {Record<string,string>} */ (labels.notes);
  const unmapped = payload.files.filter((file) => file.to.length === 0);
  /** @param {import('./migration-contracts.mjs').MigratedFile} file */
  const treatment = (file) =>
    file.to.length
      ? file.to.map(code).join(", ")
      : `${labels.archive_only}: ${notes[file.note ?? "unmatched"]}`;
  const artifacts = /** @type {Record<string,string>} */ (documents.artifacts);
  const drafts = migration.artifacts.drafts;
  const rulesFiles = payload.files.filter(
    (file) =>
      /^memory\//.test(file.origin) ||
      /^inception\/practices-discovery\//.test(file.origin),
  );
  const sections = [
    [
      "conclusion",
      labels.conclusion,
      table(
        [labels.item, labels.value],
        [
          [labels.source, code(payload.source)],
          [
            labels.files,
            fill(labels.files_value, {
              total: payload.files.length,
              mapped: payload.files.length - unmapped.length,
              unmapped: unmapped.length,
            }),
          ],
          [
            labels.blocks,
            fill(labels.blocks_value, {
              blocks: payload.audit.blocks,
              converted: payload.audit.converted,
              legacy: payload.audit.legacy,
              estimated: payload.audit.estimated,
            }),
          ],
          [labels.decision_count, payload.decisions.length],
          [labels.affirmed, cell(payload.affirmation ?? labels.no)],
        ],
        labels.none,
      ),
    ],
    [
      "progress",
      labels.progress,
      `${table(
        [labels.stage, labels.observed, labels.v2_stages, labels.artifact],
        workflow.stages.map((stage) => {
          const path = artifacts[stage] ?? "";
          const observed =
            payload.progress[/** @type {'intent'} */ (stage)] ?? null;
          return [
            stage,
            /** @type {Record<string,string>} */ (labels.progress_values)[
              observed?.state ?? "absent"
            ],
            cell(observed?.stages.join(", ") || labels.none),
            drafts.includes(path)
              ? `${code(path)} (${labels.draft})`
              : code(path),
          ];
        }),
        labels.none,
      )}\n\n${labels.units}: ${cell(payload.units.join(", ") || labels.none)}`,
    ],
    [
      "files",
      labels.table,
      table(
        [labels.file, labels.bytes, labels.destinations],
        payload.files.map((file) => [
          code(file.path),
          file.bytes,
          treatment(file),
        ]),
        labels.none,
      ),
    ],
    [
      "unmapped",
      labels.unmapped,
      table(
        [labels.file, labels.reason],
        unmapped.map((file) => [
          code(file.path),
          cell(notes[file.note ?? "unmatched"]),
        ]),
        labels.none,
      ),
    ],
    [
      "audit",
      labels.audit,
      table(
        [
          labels.event,
          labels.count,
          labels.converted,
          labels.legacy,
          labels.estimated,
        ],
        payload.audit.types.map((type) => [
          code(type.name),
          type.count,
          type.converted ? `${code(type.to)} × ${type.converted}` : "—",
          type.legacy,
          type.estimated,
        ]),
        labels.none,
      ),
    ],
    [
      "decisions",
      labels.decisions,
      `${labels.decisions_note}\n\n${table(
        [labels.record, labels.event, labels.time, labels.origin],
        payload.decisions.map((item) => [
          cell(item.id),
          cell(item.name),
          cell(item.ts),
          code(item.source_path),
        ]),
        labels.none,
      )}`,
    ],
    [
      "rules",
      labels.rules,
      `${labels.rules_note}\n\n${labels.affirmed}: ${cell(payload.affirmation ?? labels.no)}\n\n${table(
        [labels.file, labels.treatment],
        rulesFiles.map((file) => [code(file.path), treatment(file)]),
        labels.none,
      )}`,
    ],
    [
      "knowledge",
      labels.knowledge,
      `${labels.knowledge_note}\n\n${table(
        [
          labels.repo,
          labels.files,
          labels.scanned,
          labels.commit,
          labels.generation,
        ],
        payload.codekb.map((repo) => [
          cell(repo.repo),
          repo.files,
          cell(repo.scanned ?? labels.none),
          cell(repo.commit ?? labels.none),
          repo.verifiable ? labels.verifiable : labels.unverifiable,
        ]),
        labels.none,
      )}`,
    ],
    [
      "limits",
      labels.limits,
      labels.limit_items.map((item) => `- ${item}`).join("\n"),
    ],
  ];
  return [
    "---",
    "status: draft",
    `source: ${payload.source}`,
    `intent: ${payload.intent}`,
    `files: ${payload.files.length}`,
    "---",
    "",
    `# ${labels.title}: ${payload.intent}`,
    "",
    labels.lead,
    "",
    ...sections.flatMap(([id, heading, body]) => [
      `<!-- sec:${id} -->`,
      `## ${heading}`,
      "",
      body,
      "",
    ]),
  ].join("\n");
}
