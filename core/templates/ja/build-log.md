# Build log: 未記入

これは記入用の記録。未記入の欄は実施・合格を意味しない。承認済みの intent.md の AC-n と Unit ID をそのまま使う。DoD の記録は最後の節の後ろに DoD コマンドが追記し、モデルも人も書き換えない。[R-PROJECT-3]

<!-- sec:summary -->
## 要約

| Intent | 承認の証跡 | Unit の状況 | 最新の DoD | 未解決 |
| --- | --- | --- | --- | --- |
| 未記入 | intent.approved の ID と版: 未記入 | 未記入 | 未実行 | 未記入 |

承認済みでない計画では実装しない。承認の証跡は監査ログから引き、自分で作らない。[R-PROJECT-1]

<!-- sec:units -->
## Unit とコミット

| Unit | ブランチ・worktree | コミット（型と SHA の順） | DoD の記録 | 状態 |
| --- | --- | --- | --- | --- |
| 未記入 | 未記入 | `contract` → `test` → `feat` → `refactor`: 未記入 | 未実行 | 未着手 |

コミットの型と順序は build.json に従い、フックが検査する。契約とテストより先に実装をコミットしない。[R-PROJECT-5]

<!-- sec:verification -->
## AC の検証と証拠

| AC | 方法（自動テスト / AI 操作 / 人） | 証拠 | 結果 | 未実施の理由 |
| --- | --- | --- | --- | --- |
| AC-n | 未記入 | `test:ファイル › テスト名` / `log:build-log#L行` / `shot:画像パス` / `commit:ハッシュ` | 未実行 | 未記入 |

intent.md で宣言した方法で検証する。自動で検証できるものを人に回さない。実行していない検査を証拠や成功として書かない。[R-PROJECT-2]

<!-- sec:environment -->
## 検証環境とデモ

| 対象 | 構成 | 実行した手順 | 結果と証拠 |
| --- | --- | --- | --- |
| ローカルの AI 操作 | workflow.json の verification を既定とする | 未記入 | 未実行 |
| サービス（compose） | vouch/knowledge/infra/ の構成: 未記入 | 未記入 | 不要なら理由を記す |
| demo.sh | Intent フォルダの demo.sh | 未記入 | 未実行 |
| 非機能の計測（H） | 未記入 | 未記入 | 未実行 |

demo.sh は人と CI が同じ手順を再実行できる形にする。本番の環境やデータに接続しない。[R-PROJECT-4]

<!-- sec:findings -->
## 指摘への対応と既定案

| R-n / Q-n | 往復 | 対応（再現テスト → 修正のコミット） | 状態 | 直さない・既定の理由 |
| --- | --- | --- | --- | --- |
| 未記入 | 0 | 未記入 | 未対応 | 未記入 |

往復の上限は stage-authoring.json の review_rounds。未回答の判断依頼は既定案で進め、人の回答と区別して Brief §7 へ引き継ぐ。[R-PROJECT-6]

<!-- sec:references -->
## 参照元

記入欄。実際に読んだコード・設計・規約の参照元を、パス:行@コミット、文書#節@日付、公式 URL＋節で列挙する。[R-PROJECT-2]

<!-- sec:dod -->
## DoD の記録

以下は `vouch-dod.mjs` が実行した rules.md の DoD の出力と結果で、コマンドだけが追記する。
