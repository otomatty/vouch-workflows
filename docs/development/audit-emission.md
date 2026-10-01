# 監査イベントの発火

## 範囲

[Issue #12](https://github.com/otomatty/vouch-workflows/issues/12) の対応表です。正典の27種は `core/registry/audit-events.json` のままです。発火条件、入力の出所、担当フック、契約テスト、計測の取り方は `core/registry/audit-emission.json` に置き、`tests/registry/audit-emission.test.mjs` が台帳と突き合わせます。保管先は `vouch/intents/<intent>/audit/events.jsonl` です。

決定記録 §18 を優先し、Q1〜Q6 は開き直しません。実行時依存は増やしていません。共通の `core/hooks/lib/io.mjs` がコマンドを起動できたことは、そのイベントの製品 emit ではありません。synthetic fixture のスキーマ合格も実機の発火ではありません。

## 入力の区別

- captured：採取したハーネス入力を `deriveFixture` で cwd や prompt だけ変えて使う。台帳の fixture は `synthetic: false` かつ `provenance: captured` です。
- command：人が明示した操作名で `vouch-lifecycle.mjs` または既存の登録コマンドを起動する。stdin の採取入力ではありません。
- migration：`vouch-migrate.mjs` が v2 の記録を変換する経路。製品フックとは別に台帳の `migration` に書き、estimated と legacy.* は実測に入れません。

tokens は Claude の payload が `{in, out, cache?}` の非負整数を持っていた時だけ session.started / session.resumed / session.compacted に写します。Codex の payload に同じフィールドがあっても記録しません。取れない値を 0 や推定で埋めません。

## 計測

- duration_ms：親の ts からその記録の ts まで、または resume の復元にかかった時間。同じ ID の再送は最初の ts と、resume では最初の duration_ms と tokens を保ちます。
- wait_ms：ゲートや判断依頼の親の ts からの時間。同じ人の回答が gate.approved または gate.rejected と intent.approved の両方になる時、レポートの合計と intent.completed の human_review_ms はゲート側を足しません。記録上の wait_ms は残し、対象 ID は report.shared_waits と measures の excluded に出します。
- intent.completed の ai_work_ms は duration_ms から判断依頼の待ちと、共有分を除いたレビューの待ちを引いた値です。親がない、時刻が逆、または内訳が負なら記録しません。
- unit.completed の files_changed / lines_changed は `git diff --numstat HEAD` の数値です。バイナリの `-` は記録しません。0 は差分がない実測です。
- learn.recorded の rules_added は、追跡されている vouch/rules.md の HEAD との差分のうち、追加された表の行です。
- review.completed の findings と sabotage は review.md の R-n と破壊検査の表から数えます。
- build の stage.completed に必要な loop_iterations と tests はフックが記録しないため、`stage-completed build` は LIFECYCLE-UNMEASURED で拒否します。

## セッション

SessionStart の startup / resume / compact だけが session.started / session.resumed / session.compacted を記録します。clear は要約だけです。監査が壊れている時、startup は要約を出さず、resume と compact は要約を出して追記しません。session.ended は `session-ended <session>` です。Stop はターンの終わりであり、session.ended を出しません。

## 検証の境界

契約テストは各イベントの正例・負例・子プロセスを台帳のパスで結びます。ストアの一括検証、同一 ID の冪等、同一 ID で内容が違う拒否、Intent ごとの分離は `tests/unit/lib/audit.test.mjs` にあり、製品 emit としては数えません。既存の golden と synthetic fixture は変更していません。

コマンドの記録は採取した stdin ではなく、実機の CLI で27種全部を観測したことにはなりません。Codex の tokens、build の完了カウンタ、Stop からのセッション終了は取得できないものとして残しています。
