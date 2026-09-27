# Vouch workflows

Claude Code と Codex 向けの開発ワークフロー。仕様書は [docs/README.md](docs/README.md) から参照できます。

レジストリ、入出力スキーマ、JSDoc の契約と、共通ランタイム（入力検査・ファイル操作・監査記録）を実装しています。製品フック、Skill、エージェント、配布物は未実装です。[レジストリ契約](docs/development/contracts.md)と[共通ランタイムの検査範囲](docs/development/runtime.md)に、実装済みの検査と後続作業を記録しています。

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
| `npm run check` | Lint → 型検査 → テスト。CI と共通の入口 |
| `npm run lint` | Biome、markdownlint、dependency-cruiser、knip |
| `npm run format` | JS / JSON の整形と安全な自動修正 |
| `npm run typecheck` | `.mjs` の JSDoc を TypeScript 6 で検査 |
| `npm test` | 実装済みのテスト階層を実行 |
| `npm run test:unit` | lib の単体テスト。未実装なら失敗 |
| `npm run test:hooks` | 子プロセステスト。現在は共通 io のテスト用 driver が対象 |
| `npm run mutate` | lib のミューテーション検査。スコアは未測定 |

環境の検証範囲と後続作業は [開発環境の説明](docs/development/setup.md) を参照してください。
