# Vouch 実装の入力ファイル

Vouch を実装するときに参照する既存ファイルをまとめたもの。

- 取得元：`otomatty/aidlc-workflows`、ブランチ `claude/relaxed-lamport-humewe`、コミット `a1aedb4`
- 作成日：2026-09-27
- `aidlc-v2-reference/` の中は、元のリポジトリと同じ相対パスで置いている

## spec/ — 仕様書

| ファイル | 役割 | 位置づけ |
|---|---|---|
| `vouch-decision-record.html` | 何を作るか。ステージ、フックの責務、監査台帳、成果物、移行の対応表、決着した既定（§18） | 必須 |
| `vouch-implementation-rules.html` | どう作るか。構造、ルール ID と強制手段、テストのルール、予算、CI、骨格コード | 必須 |
| `vouch-open-questions.html` | Q1〜Q6 の選択肢と根拠の記録。結論は決定記録 §18 に転記済み | 参照用。Q1 のイベント台帳と計測フィールド、Q3 の品質層マトリクス、Q4 の必須図の表を registry の元データとして使う |

## aidlc-v2-reference/ — AI-DLC v2 から参照するもの

### 移行の仕様

| ファイル | 何に使うか |
|---|---|
| `core/knowledge/aidlc-shared/audit-format.md` | `registry/audit-migration.json` の元。v2 の 91 イベント名をここから取る。REG-3 の fixture としてそのまま保存する |
| `core/knowledge/aidlc-shared/state-template.md` | 移行時に `aidlc-state.md` を読み取るための書式 |
| `docs/reference/12-state-machine.md` | v2 の状態遷移とチェックボックスの意味 |
| `docs/reference/16-artifact-vocabulary.md` | v2 の成果物名の一覧。Vouch での行き先の対応表を作る |
| `docs/guide/14-artifacts-reference.md` | v2 の record ディレクトリの構成 |
| `core/memory/{org,team,project}.md`、`core/memory/phases/*.md` | `vouch/rules.md` に統合する時の元データ |

### テストの fixture

| ファイル | 何に使うか |
|---|---|
| `tests/fixtures/state-*.md`（15 種） | 移行の scenario テストの入力。進行段階ごとの v2 状態ファイル |
| `tests/fixtures/audit-sample.md` | 監査ログ移行の入力 |
| `tests/fixtures/inception-artifacts/`、`construction-artifacts/`、`re-artifacts/` | 成果物移行の入力 |
| `tests/fixtures/codex-hook-payloads/payloads.json` | Codex の実機フックイベント（TEST-7） |

Claude Code の実機フック payload の fixture は v2 にない。TEST-7 を守るため、実装の最初に Claude Code から記録する。

### 設定とフック登録の参考

| ファイル | 何に使うか |
|---|---|
| `harness/claude/settings.json` | Claude Code のフック登録形式（hooks 節）。モデルや Bedrock の設定は Vouch には持ち込まない |
| `harness/codex/emit.ts` | Codex のフック登録（`HOOK_WIRING`、35〜60 行目）と `hooks.json` の生成方法 |
| `biome.json`、`knip.json`、`tsconfig*.json` | 設定の出発点。bun 前提の部分を node 向けに書き換える |

## 含めていないもの

AI-DLC v2 の `core/tools/`、`core/hooks/`、33 ステージ、14 エージェント、scopes、sensors、`dist/`、464 本のテストは Vouch では使わないので含めていない。
