# Fixture の由来

| 場所 | 由来 | 用途 |
| --- | --- | --- |
| `audit/*.jsonl` | 手製。各行に `synthetic: true` | 27監査イベントのスキーマ検査 |
| `harness/synthetic.json` | 手製。外側に `synthetic: true` | 7種の入力形状の検査。フックの実機契約テストでは使わない |
| `harness/codex/*.json` | `docs/aidlc-v2-reference/tests/fixtures/codex-hook-payloads/payloads.json` の実機由来9件 | 原本と payload が等しいことを検査。元コミットは `a1aedb4` |
| `harness/claude/**`、`harness/codex/<版>/**` | `captures/` の採取原文の行を包装したもの | 版付き実機 fixture。一覧は `harness/inventory.json` |
| `captures/` | インストール済み CLI の記録用フックが書いた stdin の原文 | 包装の出所。採取記録は各 README |
| `native/` | 配布登録を実機 CLI で動かした観測 | レビュー記録と終了コード伝播の照合。stdin の fixture ではない |
| `v2/audit-format.md` | 移行元の原本をバイト単位でコピー | 全91イベント名の抽出と移行表との比較 |

旧 Codex 9件は、採取時の版番号が元記録にありません。`version: null` のまま保ち、`model` や別の検証記録から推測しません。TEST-7 の契約実行に使えるのは、`harness/inventory.json` に載った版付き実機 fixture と、同じ種別・版から派生した `synthetic: true` の入力だけです。後続フックが読む28種の一覧と採取結果は[版付き fixture と伝播の検証](../../docs/development/harness-fixtures.md)にあります。

監査 JSONL の例には実機から emit したという意味はありません。対になる開始レコードの実在、親 ID、時間差、承認、ファイル副作用は、後続のフック／移行テストで検証します。これらは golden ではありません。
