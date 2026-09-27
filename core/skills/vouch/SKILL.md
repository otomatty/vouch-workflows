---
name: vouch
description: "Diagnose an installed Vouch workflow with doctor and explain missing Node or configuration failures. Use for Vouch setup checks and /vouch doctor requests."
user-invocable: true
reads: always
---

# Vouch

Vouch の配布先を診断する。現在対応している操作は doctor だけである。
引数なしではこの対応範囲を案内する。ask / status / report / migrate とステージ進行は未実装と伝え、完了したように扱わない。
Claude では `/vouch doctor`、Codex では `$vouch doctor` を指定できる。

## Doctor

利用者が doctor または Vouch の導入状態の確認を求めた時に、[診断の説明](references/doctor.md)を読む。
この Skill を配ったプロジェクトを対象にする。別の作業ディレクトリや環境変数から対象を推測せず、対象を特定できなければ利用者に確認する。
診断結果、未検査の範囲、必要な対処を伝えた時点で完了する。修正の依頼がなければ設定変更や再実行を続けない。

実行コマンドは必ず診断の説明にある Node コマンドを使う。[R-DOC-3]
必要な Node の版は `{{HARNESS_DIR}}/registry/runtime.json` の nodeMinimum、出力形式は `{{HARNESS_DIR}}/registry/doctor-report.schema.json` を参照する。
Node が使えない場合の案内も診断の説明に従う。縮退モードは用意しない。根拠は決定記録 §2・§18。

応答の言語は利用者の指定を優先する。指定がなければ既存の `vouch/rules.md` の language、さらに指定がなければ `{{HARNESS_DIR}}/registry/workflow.json` の defaults.language を使う。根拠は決定記録 §18 Q6。
