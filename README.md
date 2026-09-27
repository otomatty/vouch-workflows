# Vouch workflows

Claude Code と Codex 向けの開発ワークフロー。仕様書は [docs/README.md](docs/README.md) から参照できます。

レジストリ、入出力スキーマ、JSDoc の契約、共通ランタイムと、Claude のセッション開始を記録する最初の製品フックを実装しています。Claude 向けの登録設定と配布生成も実装しました。Codex 向けの登録・配布、残りのフック、Skill、エージェントは未実装です。[レジストリ契約](docs/development/contracts.md)、[共通ランタイム](docs/development/runtime.md)、[セッション開始の検証記録](docs/development/session-start.md)、[Claude 配布の契約](docs/development/claude-distribution.md)に範囲を記載しています。現在の Windows PC では記録系の p95 時間予算を満たさず、`check` は性能検査で失敗します。

## 開発環境

Node.js 22.19.0 以上、npm 10 以上、Git を使用します。ローカルの基準は Node.js 24.13.0 です。

```sh
npm ci
npm run doctor
npm run check
```

Windows で既存の npm 起動スクリプトが `MODULE_NOT_FOUND` になる場合は、Node.js 同梱の npm を直接使うラッパーで実行できます。

```powershell
.\scripts\npm.ps1 ci
.\scripts\npm.ps1 run doctor
.\scripts\npm.ps1 run check
```

依存パッケージはすべて開発用です。利用者に配るコードは Node.js 組み込みモジュールだけで動く `.mjs` とし、ビルドを挟みません。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run doctor` | Node.js、Git、固定バージョンの依存の導入状況 |
| `npm run check` | Lint → 型検査 → テスト → 配布生成・バイト一致。CI と共通の入口 |
| `npm run lint` | Biome、markdownlint、dependency-cruiser、knip |
| `npm run format` | JS / JSON の整形と安全な自動修正 |
| `npm run typecheck` | `.mjs` の JSDoc を TypeScript 6 で検査 |
| `npm test` | 実装済みのテスト階層を実行 |
| `npm run test:unit` | lib の単体テスト。未実装なら失敗 |
| `npm run test:hooks` | 共通 io とセッション開始フックの子プロセステスト・カバレッジ・時間予算 |
| `npm run package` | `dist/claude/` に現在の Claude 配布を生成 |
| `npm run package:check` | 既存の配布のファイル集合とバイト一致を読み取り専用で検査 |
| `npm run mutate` | lib のミューテーション検査。スコアは未測定 |

環境の検証範囲と後続作業は [開発環境の説明](docs/development/setup.md) を参照してください。

監査ログ検証の補助測定は `node scripts/benchmark-audit.mjs` で実行できます。synthetic なログの検索・追記だけを測定します。プロセス起動を含む時間予算の合否は `test:hooks` で検査します。[性能改善の記録](docs/development/audit-performance.md)に両者を分けて記載しています。
