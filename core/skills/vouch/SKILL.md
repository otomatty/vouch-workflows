---
name: vouch
description: "Draft a Vouch Intent plan, show intent status and unanswered decisions from artifacts, or diagnose an installation with doctor. Use for Vouch planning, status and setup requests."
user-invocable: true
reads: always
---

# Vouch

Vouch の配布先を診断する。現在対応している操作は doctor、読み取り専用 status、Intent の下書き作成である。
引数なしではこの対応範囲を案内する。ask / report / migrate と Build 以降のステージ進行は未実装と伝え、完了したように扱わない。
Claude では `/vouch doctor` または `/vouch status`、Codex では `$vouch doctor` または `$vouch status` を指定できる。

## Intent

新しい要望の計画・指定した Intent の下書き修正は [Intent Skill](../vouch-intent/SKILL.md) を読む。Claude では `/vouch-intent`、Codex では `$vouch-intent` でも指定できる。確認点と承認は人の `vouch confirm` / `vouch review` / `vouch approve` の入力でフックが記録・適用し、モデルは承認も Build 開始も行わない。

## Knowledge

知識の調査・鮮度・引用・判断依頼の検査は必要時に [Knowledge / explorer Skill](../vouch-knowledge/SKILL.md) を読む。フックは鮮度と形式を検査し、explorer が再走査範囲を判断する。

## Status

利用者が現在地・確認点・未回答の判断依頼を求めた時に、[status の説明](references/status.md)を読む。doctor で前提を確認した上で、成果物と監査の記録を根拠付きで示す。状態の更新や作業の再開は行わない。

## Doctor

利用者が doctor または Vouch の導入状態の確認を求めた時に、[診断の説明](references/doctor.md)を読む。
この Skill を配ったプロジェクトを対象にする。別の作業ディレクトリや環境変数から対象を推測せず、対象を特定できなければ利用者に確認する。
診断結果、未検査の範囲、必要な対処を伝えた時点で完了する。修正の依頼がなければ設定変更や再実行を続けない。

実行コマンドは必ず診断の説明にある Node コマンドを使う。[R-DOC-3]
必要な Node の版は `{{HARNESS_DIR}}/registry/runtime.json` の nodeMinimum、出力形式は `{{HARNESS_DIR}}/registry/doctor-report.schema.json` を参照する。
Node が使えない場合の案内も診断の説明に従う。縮退モードは用意しない。根拠は決定記録 §2・§18。

応答の言語は利用者の指定を優先する。指定がなければ既存の `vouch/rules.md` の language、さらに指定がなければ `{{HARNESS_DIR}}/registry/workflow.json` の defaults.language を使う。根拠は決定記録 §18 Q6。
