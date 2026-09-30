---
name: vouch-knowledge
description: "Inspect Vouch knowledge freshness, act as explorer to rescan changed areas, or check artifact citations and decision cards. Read specialist knowledge only when the task needs it."
user-invocable: true
reads: on-demand
---

# Knowledge / explorer

doctor で配布と Node / Git の前提を確認する。対象は配布したプロジェクトの `vouch/knowledge/` と、明示された Intent。監査を書かず、承認を代行しない。[R-PROJECT-1] [R-PROJECT-3]

## 検査

ハーネスの人の入力として `vouch knowledge check`、`vouch knowledge refresh`、`vouch citations check` を送る。これらは既存 UserPromptSubmit フックで処理される。設定した VOUCH_INTENT、captured prompt_id / turn_id が必要で、成功も exit 2 でモデルへの送信を止めて stderr に結果を示す。通常の会話から更新や承認を推測しない。

索引は `{{HARNESS_DIR}}/registry/knowledge-index.schema.json` の契約に従う。index.json の generation は走査した完全な Git HEAD、scope は explorer が選んだ diff / full、entries の sha256 は正確な文書の UTF-8 バイト、updated は frontmatter の一意の更新日。配置は以下を参照する。

| 必要な知識 | 必要時だけ読む説明 |
| --- | --- |
| 既存コード・基準図 | [codekb / diagrams](references/code.md) |
| 設計・契約 | [design](references/design.md) |
| インフラ・構成・環境 | [infra](references/infra.md) |
| プロジェクト背景 | [background](references/background.md) |
| コーディング規約 | [rules](references/rules.md) |

## explorer への引き継ぎと再走査

鮮度の失敗を explorer の調査入力にする。hook.denied.reason の対象、索引の旧 generation、現在の HEAD、文書の更新日を渡す。explorer は Git 差分と依存関係を読み、変更領域・影響先・基準図への波及を判断して diff / full を選ぶ。フックはこの判断をしない。

初回は全層を調査する。変更のない層は以前の調査を引用し、影響がないと判断した理由を残す。文書・基準図を更新し、更新日と digest を索引に反映し、調査が完了した HEAD を generation にする。HEAD だけを合わせて調査したように扱わない。[R-PROJECT-2]

再走査した対象、根拠、更新した図、影響なしと判断した領域、残件を報告する。refresh の記録成功後に citations check を行う。記録のない更新、古さの検出、再走査完了、分析の正しさを区別する。

## 引用と判断依頼

成果物の `<!-- sec:references -->` に `[根拠]` と `(path:行@完全SHA)` または `(path#節ID@YYYY-MM-DD)` を連結した Markdown link を置く。節は `<!-- sec:ID -->` / HTML の明示 id、日付は文書 frontmatter の updated。root 外のパス・リンク・欠損・古い世代を根拠にしない。[R-PROJECT-2]

判断依頼 Q-番号は decisions テンプレートの marker と2〜4案の表を使う。状況、各案の利点・欠点・参照元、推奨と理由、未回答時の既定、影響を埋める。既定を作れない場合は `blocking: 理由` とする。Q-n の記入枠を実際の質問・人の回答に数えない。[R-PROJECT-2] [R-PROJECT-6]

外部資料は通常のハーネスの許可された読取経路で explorer が確認する。https URL＋節、確認日、ローカル snapshot とその sha256 を external.json の version:1 / records に保存する。フックはネットワークに接続せず、確認記録の存在・鮮度・snapshot の digest だけを検査する。公式性と根拠の意味は reviewer / 人が確認する。[R-HOOK-5] [R-PROJECT-2]

## status / Brief への引き継ぎ

knowledge.refreshed と hook.check / hook.denied を ID と世代つきで参照し、更新対象と鮮度・引用の警告を Brief に載せる。§6 は保留、§7 は未回答・適用した既定を残し、人の回答・承認に置き換えない。承認済み Brief は書き換えず修正案を返す。[R-PROJECT-1] [R-PROJECT-6]

構造検査の合格を実モデル評価や人の実承認の合格として報告しない。読み取り・再走査・更新の範囲を明記して終了する。
