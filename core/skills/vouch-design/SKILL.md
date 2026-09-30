---
name: vouch-design
description: "Draft or revise the Vouch design for an Intent whose plan requires Design: diff diagrams against the baseline, contracts first, alternatives and trade-offs, and threat viewpoints for high risk. Adoption is confirmed by a person."
user-invocable: true
reads: on-demand
---

# Design の下書き

Design が必要な Intent の design.md を、差分図と契約を主にしたレビュー可能な下書きにする。根拠は決定記録 §5・§13・§14・§18 Q2 / Q4。
採択は人の `vouch confirm design` をフックが design.md の内容に結び付けて記録する。この Skill は採択・承認・Build をしない。[R-PROJECT-1]

## 対象と出力

同じ配布先の [doctor](../vouch/references/doctor.md) を実行する。Node 不在や診断失敗なら編集せず、結果と未実施の範囲を返す。[R-PROJECT-7]
対象は利用者が指定した Intent だけにする。候補が複数なら対象の特定だけを求め、更新日時から選ばない。
intent.md の `sec:plan` の表で、Design の欄が `required` の Unit、または `H` の Unit がある時に行う（`{{HARNESS_DIR}}/registry/approval.json`）。どちらもなければ Design は不要と根拠つきで返し、design.md を作らない。
intent.md が draft のうちに行う。Design の確認点は Intent 承認の条件であり、Intent の確認と同じモブ・エラボレーションの中で扱う。承認済みの Intent の設計を変える必要が出たら design.md を変えず、新しい Intent の下書きとして提案する。[R-PROJECT-1]

出力は同じ Intent フォルダの design.md（ファイル名は `{{HARNESS_DIR}}/registry/project-documents.json`）。新規の frontmatter は `{{HARNESS_DIR}}/registry/stage-authoring.json` の design_frontmatter に従い、status を draft 以外にしない。既存の design.md は差分編集し、人の言葉・ID・引用を残す。
言語は利用者の指定、vouch/rules.md の language、`{{HARNESS_DIR}}/registry/workflow.json` の既定の順に選ぶ。日本語は `{{HARNESS_DIR}}/templates/ja/design.md`、英語は `{{HARNESS_DIR}}/templates/en/design.md` を基にする。識別子は英語のままにする。
節 ID と順序は stage-authoring.json の design_sections が正典である。

## 判断する内容

基準図とコードを読み、理想形・現状・今回埋める差分と埋めない差分を分ける。根本原因を解決する最小の変更にし、将来のための汎化をしない。知識が古ければ [Knowledge / explorer Skill](../vouch-knowledge/SKILL.md) で再走査を依頼し、未実施の鮮度検査を成功としない。[R-PROJECT-2]
代替案は「何もしない」を含めて比べ、利点・欠点・根拠・採否を残す。人が選ぶべき案は decisions.md の Q-n にし、未回答でも既定案で下書きの独立部分を進める。既定案で採択を代行しない。[R-PROJECT-6]
型・スキーマ・データ定義・インターフェースの契約を先に固め、どの DoD の検査で確かめるかを示す。Build は契約のコミットから始まる。

図は `{{HARNESS_DIR}}/registry/diagrams.json` の design を使う。常設の図を AC と実際の構成で埋め、条件付きの図は該当する時だけ埋めて、該当しなければ不適用の理由を残す。
差分の色は diagrams.json の diff の classDef 3行だけを使い、他の色を足さない。stage-authoring.json の diff_kinds 以外の図では、名前の後の `added` / `changed` / `removed` で差分を示す。未記入の図を完成と数えない。

品質層は `{{HARNESS_DIR}}/registry/quality-layers.json` で Intent のリスク階層（Unit の最高位）を読む。security 層が required の階層（H）では脅威モデル観点表を埋める。H の非機能の計測予定を Unit ごとの設計に置く。H は各 Unit の確認点も加わる（workflow.json の high_risk_adds）。
品質層と破壊検査の数、依存監査は registry を正典にし、本文に書き写さない。まだ実行していない検査を証拠や成功として書かない。[R-PROJECT-2]

## 確認と終了条件

下書き、図ごとの適用・不適用、契約、代替案、未確定の Q-n、参照元を報告する。
採択の依頼は1回だけにする。人が `vouch confirm design` を入力するとフックが記録する。その後に design.md を変えたら、その確認は古くなり、人に確認し直してもらう。ファイルの存在、無回答、既定適用、構造化質問の回答は確認ではない。[R-PROJECT-1]
Intent の承認は [Intent Skill](../vouch-intent/SKILL.md) の案内に従い、人の `vouch review` と `vouch approve <ゲート ID>` でフックが記録・適用する。モデルは approved に変更しない。
監査ログは作成・追記・編集しない。記録の有無は監査ログを読んで示す。[R-PROJECT-3]
