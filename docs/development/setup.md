# 開発環境

## 採用した構成

実装ルール §3 に合わせ、npm、Biome 2、TypeScript 6、dependency-cruiser、markdownlint-cli2、knip 6、Ajv、StrykerJS を使用します。バージョンは `package.json` で完全固定し、推移依存は `package-lock.json` に記録します。導入は `npm ci` で再現します。lockfile を書き換える npm の版と手順は[lockfile の生成](lockfile.md)に記載します。npm 11.5.0〜11.6.2 では lockfile を書き換えません。

`.npmrc` は `engine-strict=true` と `save-exact=true` を設定しています。開発用の最小バージョンは Node.js 22.19.0、ローカルの基準は 24.13.0 です。22.19.0 はテスト機能と開発依存の要件を満たす共通の下限です。

`.mjs` と JSDoc を `checkJs`、`strict`、`noEmit` で検査します。Node.js 向けの `NodeNext` 解決を使い、Bun の型は持ち込みません。

元資料の `docs/spec/` と `docs/aidlc-v2-reference/` は検査・自動整形の対象から外しています。fixture と golden も自動整形しません。

Stryker 10 の `typed-rest-client` が固定する `qs` に npm audit の指摘があったため、`overrides` で修正済みの 6.16.0 を指定しています。knip 6 は Stryker に内蔵された command runner を別パッケージとして検出するため、存在しない `@stryker-mutator/command-runner` だけを依存検出から除外しています。

## 配置

| パス | 用途 |
| --- | --- |
| `core/hooks/lib/` | フックが使う共通処理 |
| `core/hooks/` | フックのエントリ |
| `core/skills/`、`core/agents/` | Skill とエージェントの原本 |
| `core/templates/ja/`、`core/templates/en/` | 日英の成果物テンプレート |
| `core/registry/` | 監査・移行・品質層・図・強制ルール・既定値・予算と JSON Schema |
| `harness/claude/`、`harness/codex/` | ハーネスごとの配布設定 |
| `scripts/` | 開発用コマンド。配布物には含めない |
| `tests/` | content / registry / unit / hooks / packaging / scenario / eval |

空のディレクトリは `.gitkeep` で保持しています。製品コードの代わりとなるダミーのフックは置いていません。

## 検査の範囲

`npm run check` は Lint、型検査、構造テスト、各レジストリと入出力のスキーマ検査、予算検査を実行します。依存検査は循環、実行時の npm 依存、フック同士の import、lib から外側への依存、ネットワーク、共通 I/O を経由しない fs import を拒否します。

テストには Node.js 組み込みの `node:test` を使います。`t.plan(n)` の計数対象となる `t.assert` は `node:assert/strict` のラッパーです。仕様書 §7 の例のように別途 import した `assert` を呼ぶだけでは `t.plan` に計数されないため、新しいテストでは `t.assert` を使います。

テストは CPU 並列数で実行し、1 テストの上限を予算表から読みます。テスト用 preload は `fetch` を例外に差し替えます。`node:http` など別の通信手段まで遮断するサンドボックスではありません。

Node.js 22 の `--test-timeout` は分離したテストファイル全体にも適用されます。複数ケースのある hooks では、ファイルの上限を check と同じ90秒、各ケースを `hookTest()` の `timeout: 5000` と経過時間検査で5秒に制限します。同期の子プロセス待ちでタイマーが遅れても成功扱いにしません。時間予算そのものは変更していません。

unit のカバレッジ設定は行 95% / 分岐 95% / 関数 100%、hooks は行 90% / 分岐 85% です。unit は共通 lib、hooks は共通 io の driver とセッション開始フックを検査します。製品フックの子プロセスのカバレッジを集計し、全エントリのソースがレポートにあることも検査します。空の階層を個別指定すると失敗します。packaging は両ハーネスの配布のバイト一致・登録整合・変更検出、scenario は配布先での SessionStart 記録と重複防止を検査します。ワークフロー全体のシナリオは未実装です。

GitHub Actions は Ubuntu / Windows × Node.js 22.19.0 / 24.x で `npm ci`、doctor、check を実行します。bddb412 の初回 CI は lockfile の不整合で4ジョブとも `npm ci` に失敗しました。各ジョブの Node.js / npm の版と原因は[lockfile の生成](lockfile.md)に記録しています。検査コマンド全体の 90 秒予算は `scripts/check.mjs` が監視します。依存ダウンロードと runner 起動はこの計測に含めず、ジョブ全体のタイムアウトは 5 分です。

## この PC の npm 起動問題

標準の `npm` 起動スクリプトは、ユーザー側の npm の配置を解決する際に `MODULE_NOT_FOUND` で失敗しました。Node.js 本体に同梱された `npm-cli.js` は起動できています。

`scripts/npm.ps1` は `node.exe` の場所から同梱 npm を探します。PATH、ユーザーの `.npmrc`、グローバル npm は変更しません。通常の npm が動く環境ではこのスクリプトは不要です。

```powershell
.\scripts\npm.ps1 ci
.\scripts\npm.ps1 run check
```

## 本体実装で追加するもの

1. レジストリ、入出力スキーマ、JSDoc の契約は実装済みです。[契約の説明](contracts.md)と `core/registry/enforcement-map.json` に検査範囲を記載しています。
2. `sandbox()`、`runHook()`、fake clock と共通 lib は実装済みです。[共通ランタイム](runtime.md)を参照してください。セッション開始の JSONL を golden と全文比較します。
3. Claude Code 2.1.280 の `UserPromptSubmit` と `SessionStart` を採取済みです。Codex 0.153.4 の同じ2イベントも採取済みです。Claude の Write PreToolUse / PostToolUse も採取済みです。Codex のツール系と残りの版付き fixture は未採取です。既存の Codex 9件は原本と一致しますが、版番号が未記録のため契約実行には未適格です。手製の変種は `synthetic: true` で分離しています。
4. [セッション開始フック](session-start.md)を実装しました。現在の PC では p95 200ms を超え、`check` は失敗します。残りの製品フック、doctor / status / Intent 下書き以外の Skill 操作、承認の真正性検査、エージェント、rules / intent / decisions 以外の日英テンプレートは未実装です。
5. 両ハーネスの manifest・登録設定と `scripts/package.mjs` を実装しました。`package`、`package:check` を追加し、`check` のテスト成功後に実行します。[Claude 配布](claude-distribution.md)を参照してください。[Codex 配布](codex-distribution.md)も実装・実機確認済みです。配布先 [doctor](doctor.md) も実装しました。[Doctor Skill](doctor-skill.md) と Node 未導入時の案内も配布します。[status と共通文書](status.md)、AGENTS.md、日英 rules テンプレートも配布します。[Intent 下書き](intent.md)と日英 intent / decisions テンプレートも追加しました。他の Skill・エージェント・成果物テンプレートは未実装です。
6. [Intent 承認証跡の照合](approval-evidence.md)を追加しました。文書の版・実機入力の識別子・親ゲート・待ち時間を純粋関数で照合します。照合の一致は承認許可ではありません。[レビュー記録フック](intent-review.md)で、明示操作から gate.opened / intent.approved を記録します。真正性保証・書き込み保護・状態変更は未実装です。
7. [Windows の性能改善と実機再検証](performance.md)で、配布の事前検査とテストのスキーマコンパイルの重複を削減しました。その時点ではNode 22.19.0 / 24.13.0 とも全190件を完走し、187件成功・性能3件失敗でした。Codexの記録欠落は後続調査で検証環境のPATHEXT欠落と特定し、[隔離した実機検証コマンド](codex-review-smoke.md)でレビュー・承認証跡の記録を確認しました。人の実承認やモデル評価とは区別します。その時点の検査は両Nodeで全200件完走、197件成功・性能3件失敗です。続く[ファイル操作の改善](file-store-performance.md)では同期操作と日本語パスの片付けを実装し、両Nodeで212件完走、209件成功・性能3件失敗です。Windowsの起動込みの性能予算は引き続き未達です。
8. シナリオ、全ルールの強制テスト、夜間ミューテーション CI と失敗時の Issue 作成、手動評価スイート。

Stryker の設定と `mutate` コマンドは用意しています。Intent の承認証跡・時刻差分の対象を限定した測定は[承認証跡の照合](approval-evidence.md)に記録しています。FileStoreの変更前後を比較した限定測定は[ファイル操作の改善](file-store-performance.md)に記録します。lib 全体の基準測定と夜間 CI は未実施です。モデル評価のコマンドは本体実装に合わせて追加します。

Git リポジトリは `main` ブランチで初期化しています。

## 参照元

- [実装資料の目次](../README.md)
- [実装ルール §2–6](../spec/vouch-implementation-rules.html#s2)
- [決定記録 §18](../spec/vouch-decision-record.html#s18)
- [Node.js test runner](https://nodejs.org/docs/latest-v22.x/api/test.html)
- [Biome の import 制限](https://biomejs.dev/linter/rules/no-restricted-imports/)
- [Stryker の設定](https://stryker-mutator.io/docs/stryker-js/configuration/)
