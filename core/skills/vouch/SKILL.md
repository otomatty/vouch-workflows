---
name: vouch
description: "Plan a Vouch Intent, draft its Design, build an approved Intent, verify it into a Review Brief, resume after an interruption, answer an aside with ask, summarize audit measurements with report, migrate an AI-DLC v2 record with migrate, show status and unanswered decisions, or diagnose an installation with doctor. Use for Vouch workflow, resume, migration, status and setup requests."
user-invocable: true
reads: always
---

# Vouch

Vouch の4ステージ（Intent → Design → Build → Verify）を Skill で進める。現在対応している操作は doctor、読み取り専用 status、引数なしの再開、ask、report、v2 record の migrate、Intent と Design の下書き、承認済み Intent の Build、Verify と Review Brief である。
Claude では `/vouch`・`/vouch status`・`/vouch ask <質問>`・`/vouch report`・`/vouch migrate`・`/vouch doctor`、Codex では先頭を `$vouch` にして指定できる。
Cursor の Agent では同名の Skill を指定する。共通本体が個人共通にある場合も、利用者が指定したプロジェクトの規則・成果物・監査を使う。導入済みプロジェクトでは `vouch/config.json` が選ぶ本体を読み、対象のプロジェクトルートからコマンドを実行する。未有効化の場合は導入元の `init` で有効化してから使う。

## Intent

新しい要望の計画・指定した Intent の下書き修正は [Intent Skill](../vouch-intent/SKILL.md) を読む。Claude では `/vouch-intent`、Codex では `$vouch-intent` でも指定できる。確認点と承認は人の `vouch confirm` / `vouch review` / `vouch approve` の入力でフックが記録・適用し、モデルは承認を行わず、承認前に Build を始めない。

## Design・Build・Verify

計画が Design を要求する時は [Design Skill](../vouch-design/SKILL.md)、人の承認が記録・適用された Intent の実装は [Build Skill](../vouch-build/SKILL.md)、Build を終えた Intent の独立した検証と Review Brief・Learn は [Verify Skill](../vouch-verify/SKILL.md) を読む。Claude では `/vouch-design`・`/vouch-build`・`/vouch-verify`、Codex では `$vouch-design`・`$vouch-build`・`$vouch-verify` でも指定できる。
ステージの位置は成果物の frontmatter・監査ログ・Git から判断し、状態ファイルや自動遷移を作らない。承認前の Build、承認・確認点・PR のマージの代行はしない。[R-PROJECT-1]

## Knowledge

知識の調査・鮮度・引用・判断依頼の検査は必要時に [Knowledge / explorer Skill](../vouch-knowledge/SKILL.md) を読む。フックは鮮度と形式を検査し、explorer が再走査範囲を判断する。

## 再開

引数なしで呼ばれた時、またはセッション開始の「Vouch 再開要約」を受けて作業を続ける時に、[再開の説明](references/resume.md)を読む。現在地は成果物の frontmatter と監査ログから毎回導き、状態ファイルを作らない。承認・確認・回答を代行しない。

## Ask

利用者が `ask` で脇質問をした時に、[脇質問の説明](references/ask.md)を読む。別コンテキストの explorer が読み取りだけで答え、進行中の作業の状態を変えない。質問と答えはフックが監査に記録する。

## 判断依頼

Q-n の判断依頼を出す・既定案で進める時は、[判断依頼の記録](references/questions.md)を読む。人の回答は `vouch answer` の入力をフックが記録し、確認点や承認とは別に扱う。

## Report

利用者が `report` で監査の集計を求めた時に、[集計の説明](references/report.md)を読む。実測値・欠損・synthetic・推定を分け、ダッシュボードを作らない。

## Migrate

利用者が `migrate` で AI-DLC v2 の record の移行を求めた時に、[移行の説明](references/migrate.md)を読む。原本の保存・監査の変換・全件表はコマンドが行い、モデルは成果物を `status: draft` で書く。移行の完了は人の `vouch migrate approve` をフックが記録した時だけで、Intent の承認ではない。

## Status

利用者が現在地・確認点・未回答の判断依頼を求めた時に、[status の説明](references/status.md)を読む。doctor で前提を確認した上で、成果物と監査の記録を根拠付きで示す。状態の更新や作業の再開は行わない。

## 監査の記録

ステージ・Unit・レビュー・Learn・Intent の作成と完了・ゲートの承認と却下・セッション終了は、モデルが監査ファイルを手で追記せず、登録コマンドが記録する。引数が要る操作だけ、英数字と `-` のトークンを1つ付ける。操作名は `{{HARNESS_DIR}}/registry/audit-emission.json` にある。build の stage-completed は loop_iterations と tests を取得できないので記録しない。Stop はセッション終了ではない。[R-PROJECT-3]

```sh
node "{{HARNESS_DIR}}/hooks/vouch-lifecycle.mjs" <operation>
```

## Doctor

利用者が doctor または Vouch の導入状態の確認を求めた時に、[診断の説明](references/doctor.md)を読む。
利用者が指定したプロジェクトを対象にする。共通本体の配置先を対象プロジェクトとみなさず、対象を特定できなければ利用者に確認する。
診断結果、未検査の範囲、必要な対処を伝えた時点で完了する。修正の依頼がなければ設定変更や再実行を続けない。

実行コマンドは必ず診断の説明にある Node コマンドを使う。[R-DOC-3]
必要な Node の版は `{{HARNESS_DIR}}/registry/runtime.json` の nodeMinimum、出力形式は `{{HARNESS_DIR}}/registry/doctor-report.schema.json` を参照する。
Node が使えない場合の案内も診断の説明に従う。縮退モードは用意しない。根拠は決定記録 §2・§18。

応答の言語は利用者の指定を優先する。指定がなければ既存の `vouch/rules.md` の language、さらに指定がなければ `{{HARNESS_DIR}}/registry/workflow.json` の defaults.language を使う。根拠は決定記録 §18 Q6。
