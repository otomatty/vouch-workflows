---
name: vouch-verify
description: "Verify a built Vouch Intent in a separate reviewer context: reproduce evidence, sabotage tests, return findings to the builder within a round limit, and write the Review Brief used as the PR description. People merge the PR and adopt Learn proposals."
user-invocable: true
reads: on-demand
---

# Verify と Review Brief

Build を終えた Intent を builder と別のコンテキストで検証し、Review Brief（review.md）を PR 本文として用意する。末尾の Learn で rules.md への追記案を示す。根拠は決定記録 §5・§6・§9・§10・§13・§14・§18。
PR の承認とマージ、Learn の採択は人が行う。この Skill は承認・マージを代行しない。[R-PROJECT-1]

## 開始の条件

同じ配布先の [doctor](../vouch/references/doctor.md) を実行する。Node 不在や診断失敗なら検証せず、結果を返す。[R-PROJECT-7]
対象は利用者が指定した、VOUCH_INTENT と同じ Intent にする。intent.md が approved で承認の証跡があり、各 Unit のコードを変えた最後のコミットに DoD 合格の記録があることを監査ログで確かめる。なければ Verify を始めず、足りないものを返す。
言語は利用者の指定、vouch/rules.md の language、`{{HARNESS_DIR}}/registry/workflow.json` の既定の順に選ぶ。

## 独立した検証

`vouch-reviewer` エージェントを builder と別のコンテキストで起動する。別ハーネスでの起動を推奨する。渡すのは成果物（intent.md、design.md、decisions.md、build-log.md）、監査ログ、rules.md、知識レイヤー、コミット順つきの差分だけで、builder の会話・思考は渡さない。[R-PROJECT-5]

```sh
git log --reverse --stat "<基点>..HEAD"
git diff "<基点>...HEAD"
```

基点は Intent のブランチが分かれた保護対象の枝（`{{HARNESS_DIR}}/registry/build.json` の protected）である。
reviewer は rules.md の DoD を自分で実行し、AC を intent.md の方法で自分で再現する。AI 操作の検証は workflow.json の verification の local を既定とし、demo.sh と compose の構成も自分で動かす。builder の証拠を引き写さない。
観点表・破壊検査・依存監査は `{{HARNESS_DIR}}/registry/quality-layers.json` の Intent のリスク階層で決まり、数を本文に書き写さない。破壊した変更は検査のたびに戻し、コミットしない。その場しのぎ（根本原因に触れない分岐、握りつぶし、複製、型の緩和、テストのスキップ、差分に書かれていない妥協）を探す。[R-PROJECT-5]

## 指摘の戻し

指摘は review.md に R-n として、該当箇所・再現手順・期待・観測・根拠を書き、人を介さず [Build Skill](../vouch-build/SKILL.md) の builder に戻す。reviewer は自分でコードを直さない。
builder の修正後、reviewer を新しいコンテキストで起動し直し、同じ手順を再実行する。往復の上限は `{{HARNESS_DIR}}/registry/stage-authoring.json` の review_rounds である。上限に達して解消しない指摘は Brief §8 の未解決として人に示し、往復を続けない。

## Review Brief

review.md（名前は `{{HARNESS_DIR}}/registry/project-documents.json`）を、日本語は `{{HARNESS_DIR}}/templates/ja/review.md`、英語は `{{HARNESS_DIR}}/templates/en/review.md` から作る。節は stage-authoring.json の review_sections の9節を固定の順で使う。
1〜4節に実装コードを書かない（4節の Mermaid 図は置く）。主張には証拠（stage-authoring.json の evidence の書式）と参照元を付け、builder の証拠と reviewer の再現が食い違う行を人が見るべき箇所として示す。[R-PROJECT-2]
図は `{{HARNESS_DIR}}/registry/diagrams.json` の review を使い、主フローの sequence 図を置く。UI の変更は Before / After の画像、設計の変更は design.md の差分図を引く。該当しない図は不適用の理由を残す。
読むべき箇所ガイドは hunk を stage-authoring.json の hunks に分ける。5分版を置き、H は15分版で人が読むコアロジックの hunk を示す。
§6 は先送りした判断依頼を優先度順に並べ、カード本体は decisions.md に置く。記録に答えがあるものは載せない。
§7 には D-n、採用しなかった案、知識の警告、参照元と、未回答のまま既定案で進めた判断依頼を「Q-n 未回答・既定 X」として question.defaulted の ID とともに載せる（[判断依頼の記録](../vouch/references/questions.md)）。既定適用は人の回答ではない。[R-PROJECT-6]
監査にない記録（質問・回答・レビューのイベントなど）を作らず、未記録と書く。[R-PROJECT-3]

## PR と Learn

Intent のブランチを push し、Brief を本文にした PR を作る。PR を作る手段がハーネスになければ、ブランチ名と review.md のパスを返して人に作成を頼む。

```sh
git push -u origin "<Intent のブランチ>"
```

PR のマージはリスク階層にかかわらず人が行う。モデルはマージせず、自動マージを設定しない。人が既定案を覆したら builder に戻して直し、reviewer を再実行する。[R-PROJECT-1] [R-PROJECT-4]
Learn では、繰り返し出た論点や訂正を rules.md への追記案として Brief §9 に参照元つきで示す。人が採用した案だけを、人の言葉と出所を decisions.md に残した上で vouch/rules.md の Corrections の表に追記する。採用前の案を規約として扱わない。[R-PROJECT-1]

## 終了条件

Brief が9節そろい、指摘が解消するか §8 に残り、PR 本文として用意できた時に完了する。検証の結果、未解決、人に判断してほしいこと、Learn の追記案を報告する。
構造の合格や reviewer の判定を人の承認に置き換えない。監査ログを手で作成・追記・編集しない。レビューの依頼と完了、人が採用した rules.md の追記、セッション終了は登録コマンドが記録する。[R-PROJECT-1] [R-PROJECT-3]

```sh
node "{{HARNESS_DIR}}/hooks/vouch-lifecycle.mjs" <operation>
```
