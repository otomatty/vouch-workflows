---
status: draft
source: aidlc/spaces/default/intents/250615-widget
intent: 250615-widget
files: 26
---

# 移行レポート: 250615-widget

AI-DLC v2 の record を Vouch へ移した結果の Review Brief。下の全件表と `vouch/archive/aidlc-v2/` の原本を根拠にする。人が `vouch migrate approve <このファイルの sha256>` を入力し、フックが migration.completed を記録するまで承認ではない。intent.md / design.md は status: draft のままで、v2 の承認・確認から Vouch の承認・確認点を作らない。

<!-- sec:conclusion -->
## 1. 結論

| 項目 | 値 |
| --- | --- |
| 移行元 | `aidlc/spaces/default/intents/250615-widget` |
| 元ファイル | 26（archive 26、行き先あり 19、行き先なし 7） |
| 監査ブロック | 13（変換 4、legacy 9、推定を含む 2） |
| 人の決定の候補 | 1 |
| 規約の affirm の証跡 | なし |

<!-- sec:progress -->
## 2. v2 の進捗と4ステージ

| ステージ | v2 の観測 | v2 のステージ | 移行先の成果物 |
| --- | --- | --- | --- |
| intent | 完了 | intent-capture [x], market-research [x], feasibility [x], scope-definition [x], team-formation [x], rough-mockups [x], approval-handoff [x], requirements-analysis [x], user-stories [x], units-generation [x], delivery-planning [x] | `intent.md` (status: draft) |
| design | 進行中 | refined-mockups [x], domain-design [x], contract-design [x], functional-design [x] (widget-cart), nfr-requirements [x] (widget-cart), functional-design [-] (widget-checkout), nfr-requirements [ ] (widget-checkout), nfr-design [ ] (widget-checkout), infrastructure-design [ ] (widget-checkout) | `design.md` (status: draft) |
| build | 未着手 | code-generation [ ] (widget-checkout), build-and-test [ ] (widget-checkout), ci-pipeline [ ] (widget-checkout) | `build-log.md` |
| verify | なし | なし | `review.md` |

v2 の Unit: widget-cart, widget-checkout

<!-- sec:files -->
## 3. 元ファイル → 行き先（全件）

| 元ファイル | バイト | 行き先 |
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
| `aidlc/spaces/default/intents/250615-widget/inception/requirements-analysis/memory.md` | 17 | なし（archive のみ）: ステージの日誌（memory.md） |
| `aidlc/spaces/default/intents/250615-widget/inception/requirements-analysis/requirements-analysis-questions.md` | 158 | `intent.md#acceptance`, `decisions.md#decisions` |
| `aidlc/spaces/default/intents/250615-widget/inception/requirements-analysis/requirements.md` | 669 | `intent.md#acceptance` |
| `aidlc/spaces/default/intents/250615-widget/inception/units-generation/unit-of-work-story-map.md` | 758 | `design.md`, `intent.md#plan` |
| `aidlc/spaces/default/intents/250615-widget/inception/units-generation/unit-of-work.md` | 532 | `design.md`, `intent.md#plan` |
| `aidlc/spaces/default/intents/250615-widget/notes/extra.md` | 8 | なし（archive のみ）: 対応する行き先がない |
| `aidlc/spaces/default/intents/250615-widget/operation/deployment-pipeline/cd-config.md` | 12 | なし（archive のみ）: operation は archive のみ |
| `aidlc/spaces/default/intents/250615-widget/runtime-graph.json` | 3 | なし（archive のみ）: 一時・再生成できるファイル |
| `aidlc/spaces/default/memory/org.md` | 13966 | なし（archive のみ）: affirm されていない org / phases の既定 |
| `aidlc/spaces/default/memory/phases/inception.md` | 1258 | なし（archive のみ）: affirm されていない org / phases の既定 |
| `aidlc/spaces/default/memory/team.md` | 1346 | なし（archive のみ）: affirm の証跡がない |

<!-- sec:unmapped -->
## 4. 行き先のないファイル

| 元ファイル | 理由 |
| --- | --- |
| `aidlc/spaces/default/intents/250615-widget/inception/requirements-analysis/memory.md` | ステージの日誌（memory.md） |
| `aidlc/spaces/default/intents/250615-widget/notes/extra.md` | 対応する行き先がない |
| `aidlc/spaces/default/intents/250615-widget/operation/deployment-pipeline/cd-config.md` | operation は archive のみ |
| `aidlc/spaces/default/intents/250615-widget/runtime-graph.json` | 一時・再生成できるファイル |
| `aidlc/spaces/default/memory/org.md` | affirm されていない org / phases の既定 |
| `aidlc/spaces/default/memory/phases/inception.md` | affirm されていない org / phases の既定 |
| `aidlc/spaces/default/memory/team.md` | affirm の証跡がない |

<!-- sec:audit -->
## 5. 監査の変換

| v2 イベント | 件数 | 変換先 | legacy | 推定 |
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
## 6. 人の決定の候補

decisions.md の「判断と採用しなかった案」へ原文のまま抽出し、出所（監査 ID と元ファイル）を添える。Vouch の承認・確認点・回答としては記録しない。

| 監査 ID | v2 イベント | 時刻 | 出所 |
| --- | --- | --- | --- |
| evt_bc1d1be7b572567d7419af9d64550698b666aaa344560239516d40e59d64ccbc | GATE_APPROVED | 2025-06-15T12:00:00Z | `aidlc/spaces/default/intents/250615-widget/audit/host-other.md#L27` |

<!-- sec:rules -->
## 7. 規約の統合（affirm 条件）

affirm の証跡がある時だけ team.md / project.md を vouch/rules.md へ統合する。affirm されていない org 既定と phases の既定は落とす。

規約の affirm の証跡: なし

| 元ファイル | 扱い |
| --- | --- |
| `aidlc/spaces/default/memory/org.md` | なし（archive のみ）: affirm されていない org / phases の既定 |
| `aidlc/spaces/default/memory/phases/inception.md` | なし（archive のみ）: affirm されていない org / phases の既定 |
| `aidlc/spaces/default/memory/team.md` | なし（archive のみ）: affirm の証跡がない |

<!-- sec:knowledge -->
## 8. codekb の世代と鮮度

vouch/knowledge/codekb/<repo>/ へ移し、索引の generation は走査した完全な SHA に限る。移行の直後に `vouch knowledge check` を実行し、古い・不明な世代は explorer が再走査する。

| repo | 元ファイル | 走査日 | commit | 世代 |
| --- | --- | --- | --- | --- |
| widget-app | 5 | 2026-07-27 | fixture (no repository) | 検証できない（再走査が必要） |

<!-- sec:limits -->
## 9. 推測しなかったこと

- GATE_APPROVED・SUMMARY_CONFIRMATION_RECORDED などから Intent の承認・確認点・回答を作っていない。
- risk・session・Q-n・計測値など復元できない必須値は作らず、その記録は legacy.<NAME> に原文と出所を残した。
- 所要時間・時刻を隣接する記録から求めた記録には estimated: true を付けた。実測と混ぜない。
- operation と初期化・検証・一時ファイルは archive にのみ残した。
- 元の record は変更していない。archive は元ファイルとバイト単位で一致する。
