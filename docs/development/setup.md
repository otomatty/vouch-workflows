# 開発環境

## 採用した構成

実装ルール §3 に合わせ、npm、Biome 2、TypeScript 6、dependency-cruiser、markdownlint-cli2、knip 6、Ajv、StrykerJS を使用します。バージョンは `package.json` で完全固定し、推移依存は `package-lock.json` に記録します。導入は `npm ci` で再現します。

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

unit のカバレッジ設定は行 95% / 分岐 95% / 関数 100%、hooks は行 90% / 分岐 85% です。実装がない階層は全体実行時にその旨を表示します。空の階層を個別指定すると失敗します。現在の unit は JSDoc とスキーマの対応だけを検査し、実行時の lib 処理はありません。空のカバレッジレポートの100%を、製品コードやフックの検証済みという意味では扱いません。

GitHub Actions は Ubuntu / Windows × Node.js 22.19.0 / 24.x で `npm ci`、doctor、check を実行します。検査コマンド全体の 90 秒予算は `scripts/check.mjs` が監視します。依存ダウンロードと runner 起動はこの計測に含めず、ジョブ全体のタイムアウトは 5 分です。

## この PC の npm 起動問題

標準の `npm` 起動スクリプトは、ユーザー側の npm の配置を解決する際に `MODULE_NOT_FOUND` で失敗しました。Node.js 本体に同梱された `npm-cli.js` は起動できています。

`scripts/npm.ps1` は `node.exe` の場所から同梱 npm を探します。PATH、ユーザーの `.npmrc`、グローバル npm は変更しません。通常の npm が動く環境ではこのスクリプトは不要です。

```powershell
.\scripts\npm.ps1 ci
.\scripts\npm.ps1 run check
```

## 本体実装で追加するもの

1. レジストリ、入出力スキーマ、JSDoc の契約は実装済みです。[契約の説明](contracts.md)と `core/registry/enforcement-map.json` に検査範囲を記載しています。
2. `sandbox()`、`runHook()`、fake clock、golden 比較などのテスト用補助関数と、契約に対応する失敗テスト。
3. Claude Code の実機イベント fixture と、版情報のある Codex fixture の採取。既存の Codex 9件は原本と一致する payload を保存していますが、版番号が未記録のため契約実行には未適格です。手製のスキーマ例は `synthetic: true` で分離しています。
4. 共通 lib、フック、Skill、エージェント、日英テンプレート。
5. ハーネスの manifest と `scripts/package.mjs`。その段階で `package`、`package:check` を追加し、`check` に配布物のバイト一致検査を組み込みます。
6. シナリオ、フック子プロセスのカバレッジ収集、全ルールの強制テスト、夜間ミューテーション CI と失敗時の Issue 作成、手動評価スイート。

Stryker の設定と `mutate` コマンドは用意しています。対象の lib がないため、ミューテーションスコアはまだ測定していません。配布物とモデル評価のコマンドも本体実装に合わせて追加します。

Git リポジトリは `main` ブランチで初期化しています。

## 参照元

- [実装資料の目次](../README.md)
- [実装ルール §2–6](../spec/vouch-implementation-rules.html#s2)
- [決定記録 §18](../spec/vouch-decision-record.html#s18)
- [Node.js test runner](https://nodejs.org/docs/latest-v22.x/api/test.html)
- [Biome の import 制限](https://biomejs.dev/linter/rules/no-restricted-imports/)
- [Stryker の設定](https://stryker-mutator.io/docs/stryker-js/configuration/)
