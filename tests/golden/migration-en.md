---
status: draft
source: aidlc/spaces/default/intents/250615-widget
intent: 250615-widget
files: 26
blocks: 13
---

# Migration report: 250615-widget

Review Brief of moving an AI-DLC v2 record into Vouch. The full table below and the originals under `vouch/archive/aidlc-v2/` are its evidence. It is not approved until a person enters `vouch migrate approve <sha256 of this file>` and a hook records migration.completed. intent.md / design.md stay status: draft; no Vouch approval or checkpoint is derived from v2 approvals or confirmations.

<!-- sec:conclusion -->
## 1. Conclusion

| Item | Value |
| --- | --- |
| Source | `aidlc/spaces/default/intents/250615-widget` |
| Source files | 26 (archived 26, with a destination 19, without 7) |
| Audit blocks | 13 (converted 4, legacy 9, with estimates 2) |
| Human decision candidates | 1 |
| Rules affirmation evidence | no |

<!-- sec:progress -->
## 2. v2 progress and the four stages

| Stage | v2 observation | v2 stages | Destination artifact |
| --- | --- | --- | --- |
| intent | completed | intent-capture [x], market-research [x], feasibility [x], scope-definition [x], team-formation [x], rough-mockups [x], approval-handoff [x], requirements-analysis [x], user-stories [x], units-generation [x], delivery-planning [x] | `intent.md` (status: draft) |
| design | active | refined-mockups [x], domain-design [x], contract-design [x], functional-design [x] (widget-cart), nfr-requirements [x] (widget-cart), functional-design [-] (widget-checkout), nfr-requirements [ ] (widget-checkout), nfr-design [ ] (widget-checkout), infrastructure-design [ ] (widget-checkout) | `design.md` (status: draft) |
| build | pending | code-generation [ ] (widget-checkout), build-and-test [ ] (widget-checkout), ci-pipeline [ ] (widget-checkout) | `build-log.md` |
| verify | absent | none | `review.md` |

v2 Units: widget-cart, widget-checkout

<!-- sec:files -->
## 3. Source file → destination (all files)

| Source file | Bytes | Destinations |
| --- | --- | --- |
| `aidlc/spaces/default/codekb/widget-app/architecture-overview.md` | 768 | `vouch/knowledge/codekb/widget-app/` |
| `aidlc/spaces/default/codekb/widget-app/codebase-analysis.md` | 997 | `vouch/knowledge/codekb/widget-app/` |
| `aidlc/spaces/default/codekb/widget-app/integration-points.md` | 379 | `vouch/knowledge/codekb/widget-app/` |
| `aidlc/spaces/default/codekb/widget-app/reverse-engineering-timestamp.md` | 307 | `vouch/knowledge/codekb/widget-app/` |
| `aidlc/spaces/default/codekb/widget-app/technology-stack.md` | 326 | `vouch/knowledge/codekb/widget-app/` |
| `aidlc/spaces/default/intents/250615-widget/aidlc-state.md` | 2958 | `migration.md#progress` |
| `aidlc/spaces/default/intents/250615-widget/audit/host-clone.md` | 633 | `audit/events.jsonl` |
| `aidlc/spaces/default/intents/250615-widget/audit/host-other.md` | 1450 | `audit/events.jsonl` |
| `aidlc/spaces/default/intents/250615-widget/construction/todo-core/code-generation/code-summary.md` | 86 | `build-log.md#units`, `review.md#references` |
| `aidlc/spaces/default/intents/250615-widget/construction/todo-core/functional-design/functional-spec.md` | 1269 | `design.md#units` |
| `aidlc/spaces/default/intents/250615-widget/ideation/rough-mockups/wireframe.png` | 9 | `intent.md#analysis`, `vouch/knowledge/background/` |
| `aidlc/spaces/default/intents/250615-widget/inception/domain-design/component-dependency.md` | 596 | `design.md`, `intent.md#plan` |
| `aidlc/spaces/default/intents/250615-widget/inception/domain-design/component-methods.md` | 630 | `design.md`, `intent.md#plan` |
| `aidlc/spaces/default/intents/250615-widget/inception/domain-design/components.md` | 632 | `design.md`, `intent.md#plan` |
| `aidlc/spaces/default/intents/250615-widget/inception/domain-design/services.md` | 534 | `design.md`, `intent.md#plan` |
| `aidlc/spaces/default/intents/250615-widget/inception/requirements-analysis/memory.md` | 17 | none (archive only): stage diary (memory.md) |
| `aidlc/spaces/default/intents/250615-widget/inception/requirements-analysis/requirements-analysis-questions.md` | 158 | `intent.md#acceptance`, `decisions.md#decisions` |
| `aidlc/spaces/default/intents/250615-widget/inception/requirements-analysis/requirements.md` | 669 | `intent.md#acceptance` |
| `aidlc/spaces/default/intents/250615-widget/inception/units-generation/unit-of-work-story-map.md` | 758 | `design.md`, `intent.md#plan` |
| `aidlc/spaces/default/intents/250615-widget/inception/units-generation/unit-of-work.md` | 532 | `design.md`, `intent.md#plan` |
| `aidlc/spaces/default/intents/250615-widget/notes/extra.md` | 8 | none (archive only): no matching destination |
| `aidlc/spaces/default/intents/250615-widget/operation/deployment-pipeline/cd-config.md` | 12 | none (archive only): operation is archived only |
| `aidlc/spaces/default/intents/250615-widget/runtime-graph.json` | 3 | none (archive only): transient or derivable file |
| `aidlc/spaces/default/memory/org.md` | 13966 | none (archive only): org / phase default without affirmation |
| `aidlc/spaces/default/memory/phases/inception.md` | 1258 | none (archive only): org / phase default without affirmation |
| `aidlc/spaces/default/memory/team.md` | 1346 | none (archive only): no affirmation evidence |

<!-- sec:unmapped -->
## 4. Files without a destination

| Source file | Reason |
| --- | --- |
| `aidlc/spaces/default/intents/250615-widget/inception/requirements-analysis/memory.md` | stage diary (memory.md) |
| `aidlc/spaces/default/intents/250615-widget/notes/extra.md` | no matching destination |
| `aidlc/spaces/default/intents/250615-widget/operation/deployment-pipeline/cd-config.md` | operation is archived only |
| `aidlc/spaces/default/intents/250615-widget/runtime-graph.json` | transient or derivable file |
| `aidlc/spaces/default/memory/org.md` | org / phase default without affirmation |
| `aidlc/spaces/default/memory/phases/inception.md` | org / phase default without affirmation |
| `aidlc/spaces/default/memory/team.md` | no affirmation evidence |

<!-- sec:audit -->
## 5. Audit conversion

| v2 event | Count | Converted to | legacy | estimated |
| --- | --- | --- | --- | --- |
| `ARTIFACT_CREATED` | 1 | — | 1 | 0 |
| `GATE_APPROVED` | 1 | — | 1 | 0 |
| `RULE_LEARNED` | 1 | `learn.recorded` × 1 | 0 | 0 |
| `SESSION_STARTED` | 1 | — | 1 | 0 |
| `STAGE_COMPLETED` | 2 | `stage.completed` × 1 | 1 | 1 |
| `STAGE_STARTED` | 3 | `stage.started` × 2 | 1 | 1 |
| `SUBAGENT_COMPLETED` | 1 | — | 1 | 0 |
| `UNTYPED` | 2 | — | 2 | 0 |
| `WORKFLOW_STARTED` | 1 | — | 1 | 0 |

<!-- sec:decisions -->
## 6. Human decision candidates

Extract them verbatim into decisions.md "Decisions and rejected options" with their origin (audit ID and source file). They are not recorded as Vouch approvals, checkpoint confirmations or answers.

| Audit ID | v2 event | Time | Origin |
| --- | --- | --- | --- |
| evt_bc1d1be7b572567d7419af9d64550698b666aaa344560239516d40e59d64ccbc | GATE_APPROVED | 2025-06-15T12:00:00Z | `aidlc/spaces/default/intents/250615-widget/audit/host-other.md#L27` |

<!-- sec:rules -->
## 7. Rules integration (affirmation condition)

Integrate team.md / project.md into vouch/rules.md only with affirmation evidence. Org and phase defaults that were not affirmed are dropped.

Rules affirmation evidence: no

| Source file | Treatment |
| --- | --- |
| `aidlc/spaces/default/memory/org.md` | none (archive only): org / phase default without affirmation |
| `aidlc/spaces/default/memory/phases/inception.md` | none (archive only): org / phase default without affirmation |
| `aidlc/spaces/default/memory/team.md` | none (archive only): no affirmation evidence |

<!-- sec:knowledge -->
## 8. codekb generation and freshness

Move it to vouch/knowledge/codekb/<repo>/; the index generation is only the full SHA that was scanned. Run `vouch knowledge check` right after the migration; explorer rescans a stale or unknown generation.

| repo | Source files | Scanned | commit | Generation |
| --- | --- | --- | --- | --- |
| widget-app | 5 | 2026-07-27 | fixture (no repository) | unverifiable (rescan required) |

<!-- sec:limits -->
## 9. What was not inferred

- No Intent approval, checkpoint confirmation or answer was derived from GATE_APPROVED, SUMMARY_CONFIRMATION_RECORDED or similar records.
- Unrecoverable required values (risk, session, Q-n, measurements) were not invented; those records keep their original text and origin as legacy.<NAME>.
- Records whose duration or time was derived from neighbouring records carry estimated: true and are kept apart from measurements.
- Operation, initialization, verification and transient files stay in the archive only.
- The original record was not changed. The archive matches the source files byte for byte.
