# v2 record の移行

`/vouch migrate`（Codex は `$vouch migrate`）は、AI-DLC v2 の record（`aidlc/spaces/<space>/intents/<YYMMDD-label>`）を Vouch の Intent フォルダへ移す。コピー・監査の変換・全件表はコマンドが行い、モデルは全件表に従って成果物を書き、承認は人が行う。根拠は決定記録 §16・§18。

## 前提と計画

[doctor](doctor.md) を先に実行し、Node が使えることを確かめる。Node が使えなければ移行は未実施と伝え、手でファイルをコピーしたり監査を書いたりしない。[R-PROJECT-7]

```sh
node "{{HARNESS_DIR}}/hooks/vouch-migrate.mjs" plan <space> <YYMMDD-label>
```

record は space 名と record のディレクトリ名の2語で指定する。Intent 名は既定で record のディレクトリ名で、別名にする時は3語目に書く（以下の apply も同じ）。`_` などを含む名前は書き込みガードが通さないので、人に端末での実行を依頼する。plan は読み取りだけを行い、JSON を返す。checks の MIGRATE-FILES（リンク・読めないファイル）、MIGRATE-STATE（チェックボックスを読めない）、MIGRATE-AUDIT（時刻のないシャード）、MIGRATE-TARGET（archive・監査・移行レポート・同名の Intent と異なる内容）が不合格なら、id と detail をそのまま人に示し、どう直すかを尋ねる。元の record・archive・監査を書き換えて合格させない。[R-PROJECT-3]

## 適用

```sh
node "{{HARNESS_DIR}}/hooks/vouch-migrate.mjs" apply <space> <YYMMDD-label>
```

apply は全ファイルを `vouch/archive/aidlc-v2/` へバイト単位で複製し、監査を Intent の audit/events.jsonl に変換・追記し、`migration.md`（移行レポート）を書く。途中で失敗したら同じコマンドを再実行する。書けた分は同一として飛ばされる。MIGRATE-VERIFY が不合格なら移行を完了扱いにしない。

## 成果物を書く

移行レポートの §2〜§8 と `vouch/archive/aidlc-v2/` の原本を読み、行き先ごとに書く。テンプレートは `{{HARNESS_DIR}}/templates/<language>/` を使う。

- intent.md と design.md は `status: draft` で書く。v2 の `[x]`・GATE_APPROVED から承認・確認点を作らない。確認点と承認は人の `vouch confirm` / `vouch approve` だけが記録する。[R-PROJECT-1]
- 受入基準はストーリーの受入条件から AC-n を採番する。Unit とリスク階層・Design 要否は intent.md の計画に書き、未評価の行を残す時はそう書く。
- §6 の人の決定は decisions.md の「判断と採用しなかった案」に原文のまま D-n で写し、監査 ID と元ファイルを参照元に置く。要約・言い換えをしない。
- §7 で affirm の証跡がある時だけ team.md / project.md を vouch/rules.md に統合する。affirm されていない org / phases の既定は書かない。
- codekb は explorer が `vouch/knowledge/codekb/<repo>/` と索引を書く。generation は走査した完全な SHA に限り、不明なら現在の HEAD を走査し直す。書いた後に人へ `vouch knowledge check` の入力を求め、鮮度検査の結果を伝える。
- 行き先のないファイル（§4）は archive にだけ残る。内容を別の成果物へ移さない。

監査・archive・移行レポートはコマンドとフックが書く。モデルはこれらを編集しない。[R-PROJECT-3]

## 承認

書き終えたら plan を再実行し、artifacts の有無と status、brief.sha256 を確かめる。人には、移行レポートと書いた成果物を読み、`vouch migrate approve <brief.sha256>` を入力するよう伝える。フックは archive のコピーと移行記録の件数を確かめてから migration.completed を記録し、その時だけ移行は完了である。apply を実行していなければ VOUCH-MIGRATE-UNAPPLIED で拒否される。これは Intent の承認ではない。承認や入力を代行しない。[R-PROJECT-1]

## 返す内容

移行元、元ファイル数と行き先のない数、監査の変換・legacy・推定の数、書いた成果物、未記入・未確定の欄、鮮度検査の結果、承認に使う digest を簡潔に返す。
