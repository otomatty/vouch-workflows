# セッション開始の監査記録

## 契約

`vouch-record-session-start.mjs` は Claude Code の `SessionStart(source: startup)` を受け、明示的に選んだ Intent に `session.started` を記録します。決定記録 §11 の監査記録を実装する最初の製品フックです。状態の復元、要約、承認の判定は含みません。

入力は共通 `hook-input.schema.json` で検証します。処理対象の部分集合を `session-start-hook.schema.json` に定義します。Claude の startup 以外、Intent 未指定、入力不正は記録しません。`resume / clear / compact / fork` を新規開始と推測しません。Codex の登録と動作検証は後続です。

`VOUCH_PROJECT_ROOT` と `VOUCH_HARNESS=claude` に加え、呼び出し側が `VOUCH_INTENT` を指定します。Intent は小文字英数字から始まる1〜128文字の英数字・`-`・`_` に限定します。監査先は `<root>/vouch/intents/<intent>/audit/events.jsonl` です。stdin の `intent` や `cwd` から監査先を選びません。この設定は対象を明示するためのもので、承認や成果物の状態を証明しません。

イベントは `v:1 / type:session.started / actor:hook / harness:claude / intent / session / ts / id` を持ちます。未取得の duration や tokens は追加しません。ID は session と `['session.started', harness, intent]` から `clock.newId()` で生成します。同じ scope と session の再実行は最初の ts を再利用します。他フィールドが衝突すれば既存内容を書き換えずエラーにします。

`AuditStore.find(id)` はログ全体のスキーマと既存 ID の一意性を検証し、該当レコードか undefined を返します。既存の append 専用の注入ポートとの互換性のため型上は省略可能ですが、このフックには検索可能なストアが必要です。`io.run()` が env の scope からストアを構成し、context と記録処理に同じものを渡します。外部から注入した `RuntimeOptions.audit` はそちらを優先します。

stdout は空、許可と no-op は終了0です。I/O・破損・衝突の例外も ID 付き stderr と終了0で返します。記録専用フックは終了2を返しません。読み込みと append の間に別プロセスが競合した場合も、既存ロックやレコードを消さず共通ランタイムのエラーとして扱います。

## 検証

Claude Code 2.1.280 の `--init-only` で採取した SessionStart を使用します。CLI の設定領域は `reports/session-capture/config` に隔離し、モデルを呼び出していません。原文は保存し、cwd や source を変えたテスト入力は synthetic とします。

製品フックを子プロセスで起動し、実際の JSONL を golden と全文比較します。時刻はテスト用 preload で固定し、製品の環境変数にテスト時計を混ぜません。再実行時は時計を変えてもログが増えないこと、別セッション・別 Intent が混ざらないこと、破損・衝突・リンク・不正入力6種を検査します。golden の更新は `UPDATE_GOLDEN=1` の明示時だけです。

記録系 p95 は予算表に従って20回の子プロセス実行で計測します。フックの子プロセスからカバレッジを収集し、対象ソースがレポートに存在することも確認します。REG-2 の製品 emit 検証は今回の `session.started` だけで、残り26種は pending に残します。
