# TypeScript の採用

2026-10-04、所有者がソースを TypeScript で書き、配布する時に `.mjs` へ変換する方式を採用した。本書は実装ルール C2（`.mjs` ＋ JSDoc ＋ `tsc --checkJs`）と、README の「ビルドを挟まない」という記述に優先する。元仕様は当時の記録として保持する。

## 変えないこと

- 利用者に配るのは、Node.js の組み込みモジュールだけで動く `.mjs` のままとする。実行時の npm 依存は持たない。
- 利用者側にビルドは要らない。配布物（`dist/`）とインストーラが置く本体は、生成済みの `.mjs` だけを含む。
- 型の厳しさは従来どおり `strict`・`noUncheckedIndexedAccess`・`exactOptionalPropertyTypes` で検査する。

## 配置とビルド

ソースは `core/`・`harness/`・`scripts/`・`tests/` の `x.mts` に書く。`npm run build`（`node scripts/build.mts`）が、同じ場所に `x.mjs` を生成する。生成物は Git の管理外で、先頭に生成元を示す1行を持つ。ソースが消えた生成物は、次のビルドで削除する。`tests/fixtures/` と `tests/golden/` は既存の fixture として変換しない。

- 変換は TypeScript の `transpileModule`（ES2023、NodeNext、`verbatimModuleSyntax`）で行う。型検査はしない。Node の型除去（`stripTypeScriptTypes`）は位置を保つ代わりに型の跡を空白で残し、配布物が読みにくくなるため使わない。
- import の指定子は実行時の名前（`./x.mjs`）で書く。TypeScript は同じ場所の `x.mts` を型の参照先として解決する。文書とレジストリが名指す `x.mjs` は実行時のモジュールであり、そのソースは同じ場所の `x.mts` である。
- `tsconfig.json` は `erasableSyntaxOnly` と `verbatimModuleSyntax` を有効にする。`enum`・`namespace`・引数プロパティなど、型の除去だけで JavaScript にならない構文は使わない。型だけの import は `import type` で書く。
- `scripts/build.mts` はリポジトリの他のファイルを import せず、Node.js 22.18 以降の型除去で直接実行する。開発用の下限 22.19.0 はこれを満たす。
- 生成物の更新時刻がソースより新しければ変換しない。git の操作などでソースの更新時刻だけが進み、変換結果が同じ場合は、生成物の更新時刻を進めて次回から変換を省く。何もしないビルドは TypeScript を読み込まない。

本番の実行時に `.mts` を Node の型除去で直接動かす方式は採らない。Node 22.22 で最小のフックを比べると、起動の中央値が約52ms から約118〜135ms に延び、記録系フックの p95 200ms 未満の予算を圧迫するためである。

## コマンドと検査の対象

| 操作 | 前にビルドする | 対象 |
| --- | --- | --- |
| `npm run check`・`npm test`・`npm run test:unit`・`test:hooks`・`test:checks`・`npm run lint`・`npm run package`・`npm run package:check`・`npm run doctor` | する | 生成物を実行するか読むため。check の中では最初のビルドの後なので何も書かない |
| `node scripts/*.mjs` の直接実行（ベンチマーク・導入など） | 事前に `npm run build` が必要 | Benchmark ワークフローは `npm ci` の直後にビルドする |
| Biome・`npm run typecheck` | — | `.mts` のソース |
| dependency-cruiser・knip | — | 生成した `.mjs`（実行時の依存グラフ）。knip は生成物を読むため `--no-gitignore` で動かす |
| 行数予算（HOOK-12）・カバレッジ | — | 生成した `.mjs`（配布される実行時コードの量） |
| ソースの書き方を見る構造テスト | — | 書式に依存する検査は `.mts`。生成物は TypeScript が整形し直すため |
| Stryker | `npm run test:unit` がビルドする | `.mts` を変異させ、ビルドで生成物へ運ぶ |

型だけを定義するモジュール（`contracts`・`runtime-contracts`・`migration-contracts`）は、生成物が空の `export {}` になる。実行時に読まれないため、knip の対象から外している。

## 移行の記録

既存の292ファイル（テストと補助スクリプトを含む）を、TypeScript の言語サービスのコード修正（JSDoc の型を注釈へ移す）と、typedef・型キャスト・省略可能な引数・`@type` 付きの関数宣言を扱う一回限りの変換で `.mts` にした。変換の前後で、各ファイルの識別子と文字列・テンプレート・正規表現・数値リテラルの並びが一致することを AST で確かめた。一致しない5ファイルは、意図して変えた箇所（マニフェストの既定の export の復元、配布で `.mts` を除く処理、Biome の指摘による書き換え）だけである。変換が文字列の中の `/**` をコメントと誤認した1ファイル（`tests/unit/lib/areas.test.mts`）は、この比較で見つけて元に戻した。
