---
name: vouch-intent
description: "Draft or revise a Vouch Intent plan and decision record for a feature, bug fix or scoped change. Prepare acceptance criteria, scope, risk, units and verification for human review; approval and implementation are separate."
user-invocable: true
reads: on-demand
---

# Intent の下書き

新しい要望、または指定された Intent の修正依頼から、レビュー可能な intent.md と decisions.md を作る。根拠は決定記録 §5・§6・§10・§18。
確認点と承認は、人の明示入力（語彙は `{{HARNESS_DIR}}/registry/intent-review.json`）をフックが記録・適用する。Design は [Design Skill](../vouch-design/SKILL.md)、承認後の実装は [Build Skill](../vouch-build/SKILL.md) が扱う。文書の完成を確認・承認の完了にはしない。

## 対象と出力

同じ配布先の [doctor](../vouch/references/doctor.md) を実行する。Node 不在や診断失敗なら編集せず、結果と未実施の範囲を返す。[R-PROJECT-7]
利用者の依頼、既存 rules.md、関係する知識・コード・過去の判断を読む。すでに答えがあることは再質問しない。複数の候補や名前の衝突がある時は、対象の特定だけを求める。
新規はプロジェクト内の vouch/intents/<YYMMDD-slug>/ を使う。実際の作業日と依頼に沿う短い slug を用い、対象がプロジェクト内に解決され、既存内容と衝突しないことを確認する。リンクや ../ を辿る出力先は使わない。
既存 Intent は指定された status: draft のものだけを差分編集する。既存の記録・ID・引用・人の原文を残す。status が draft 以外、欠落、不明ならファイルを更新せず修正案を返す。採択済みの計画を新しい版へ無断で引き継がない。[R-PROJECT-1]

ファイル名は `{{HARNESS_DIR}}/registry/project-documents.json`、節とカードの欄・目安は `{{HARNESS_DIR}}/registry/intent-authoring.json` が正典である。
言語は利用者の指定を優先し、次に vouch/rules.md の language、指定がなければ `{{HARNESS_DIR}}/registry/workflow.json` の既定を使う。不正な設定は黙って置き換えず報告する。識別子 AC-n / Q-n / D-n は英語のままにする。
日本語は `{{HARNESS_DIR}}/templates/ja/intent.md` と `{{HARNESS_DIR}}/templates/ja/decisions.md`、英語は `{{HARNESS_DIR}}/templates/en/intent.md` と `{{HARNESS_DIR}}/templates/en/decisions.md` を基にする。既存 decisions.md はテンプレートで置換しない。
新規 frontmatter は draft_frontmatter に従う。これは下書き専用であり、過去の他の status を不正扱いする検査ではない。テンプレートの未記入欄を埋め、調査で決まらない項目は未確定と理由を記す。

## 判断する内容

Intent 冒頭に目的・Before/After・AC・非ゴール・分割とリスク・設計要否・未確定事項を1画面の要約として置き、詳細と出典へ辿れるようにする。
各 AC-n は成功・失敗・境界条件を観測できる形にし、担当 Unit、検証方法、証拠の予定へ対応付ける。既存ユースケースの漏れも点検する。
既存コード・文書の調査では、現在の挙動、根本原因、理想形との差分、その場しのぎになる箇所と後回しのリファクタを区別する。explorer の代わりに必要範囲を読み取れるが、実行していない再走査・鮮度検査を成功としない。参照先と観測した版、未確認の範囲を記す。[R-PROJECT-2]

分割は1つの振る舞いを1 Intent / PR / Briefに収めることを基準にする。Unit 数は unit_guideline を目安にし、機械的な上限にはしない。振る舞い不変の準備リファクタ、H の契約変更、後続の実装を分ける案と依存順を示す。公開 API・スキーマ・データ定義の変更は H の最小の Intent として提案する。根拠は決定記録 §6。
各 Unit の AC、範囲、依存、リスクと根拠、Design 要否を示す。計画の表は、リスクの欄を `L`・`M`・`H`、Design の欄を `required`・`not-required` で始める（`{{HARNESS_DIR}}/registry/approval.json`）。H または計画が要求する時は Design が必要であり、Design Skill で design.md を下書きする。この Skill では省略や採択を済ませたことにしない。
`{{HARNESS_DIR}}/registry/quality-layers.json` から階層別の必須層、破壊検査数と全階層の依存監査を計画へ反映する。DoD は既存 rules.md の実コマンドを参照し、未設定なら未設定とする。まだ実行していない検査を証拠や成功として載せない。

## 図と確認点

図の種類・条件は `{{HARNESS_DIR}}/registry/diagrams.json` の intent を使う。ユーザー操作フローを実際の AC に結び付ける。brownfield なら現状の参照元と変更影響を図にする。条件に該当しない図は不適用の理由を残す。未記入の図を完成と数えない。
確認点は workflow の topic_checkpoints と rules の checkpoints に合わせる。H は high_risk_adds の Unit 確認も追加する。確認済みとするには、人が `vouch confirm <対象>`（acceptance・scope・units・design、`unit <ID>`、`section <節 ID>`、`design unit <ID>`、`design section <節 ID>`）を入力し、フックが対象の内容に結び付けて記録した checkpoint.confirmed が必要である。ファイルの存在、無回答、既定適用、構造化質問の回答は確認ではない。確認後に対象を変えたら、その確認点だけ人に確認し直してもらう。[R-PROJECT-1]
未確定の論点があっても、既定案で下書きの独立部分は進める。既定案が作れない時は理由と止まる範囲を示す。既定案で Intent の採択・Design の承認を代行しない。[R-PROJECT-6]

## 判断記録と終了条件

decisions.md の Q-n に、状況・選択肢・各案のメリットとデメリットと根拠・推奨・既定・ブロックと影響範囲を記す。選択肢数は question_options に従い、「何もしない」を載せない時は理由を残す。前提が変わった時は元の質問と回答を参照し、差分を確認する。根拠は決定記録 §10。
必要な判断はハーネスの構造化質問が利用可能なら使う。回答は人の原文と出所を保つ。モデルの判断 D-n、推測、未回答と既定適用を別にし、Brief §6 / §7 へ引き継ぐ。形式検査フックはまだないため、欄があるだけで内容が妥当とは扱わない。[R-PROJECT-2] [R-PROJECT-6]
作った下書き、AC から検証予定への対応、根拠、確認状況、残る論点を報告して終える。承認は、人が `vouch review` で開いたゲートに `vouch approve <ゲート ID>` を入力した時にフックが記録し、確認点がそろえば同じ版を approved にする。モデルは approved に変更せず、承認を代行しない。入力の案内は1回とし、同じ承認を何度も求めない。[R-PROJECT-1]
approved になった後は、intent.md と decisions.md を承認コミットにできる。この Skill は Build を開始しない。実装は利用者が Build Skill を指定した時に始め、承認済みでない計画では実装しない。[R-PROJECT-1]
監査ログは作成・追記・編集しない。記録の有無は監査ログを読んで示し、フックの記録を自分で補わない。[R-PROJECT-3]
