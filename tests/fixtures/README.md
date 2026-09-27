# Fixture の由来

| 場所 | 由来 | 用途 |
| --- | --- | --- |
| `audit/*.jsonl` | 手製。各行に `synthetic: true` | 27監査イベントのスキーマ検査 |
| `harness/synthetic.json` | 手製。外側に `synthetic: true` | 7種の入力形状の検査。フックの実機契約テストでは使わない |
| `harness/codex/*.json` | `docs/aidlc-v2-reference/tests/fixtures/codex-hook-payloads/payloads.json` の実機由来9件 | 原本と payload が等しいことを検査。元コミットは `a1aedb4` |
| `v2/audit-format.md` | 移行元の原本をバイト単位でコピー | 全91イベント名の抽出と移行表との比較 |

Codex の採取時の版番号は元記録にありません。`version: null` のまま保ち、`model` や別の検証記録から推測しません。現在、TEST-7 に適格な版付き実機 fixture はありません。Claude Code の実機 fixture も未採取です。

監査 JSONL の例には実機から emit したという意味はありません。対になる開始レコードの実在、親 ID、時間差、承認、ファイル副作用は、後続のフック／移行テストで検証します。これらは golden ではありません。
