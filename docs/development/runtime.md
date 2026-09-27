# 共通ランタイムとテスト基盤

## 契約

前段の [レジストリ契約](contracts.md)に、次の API を追加します。フックの登録・成果物からの状態導出・人の承認の検証は別の実装です。

| モジュール | API | 契約 |
| --- | --- | --- |
| `clock.mjs` | `now()`, `newId(session, identity)` | UTC 時刻、セッションと入力識別子の決定的 ID |
| `env.mjs` | `readContext(env?)` | 明示された `VOUCH_PROJECT_ROOT` と `VOUCH_HARNESS` を読む。未設定や不正値は拒否 |
| `validation.mjs` | `parseInput(text)`, `isAuditEvent(value)`, `isHookResult(value)` | 既存 JSON Schema の利用部分を依存ゼロで評価。未知のスキーマ構文はエラー |
| `fs.mjs` | `createFileStore(root)` | root 内の読み込み・原子的な更新。シンボリックリンク・junction・複数リンクのファイルを拒否 |
| `audit.mjs` | `createAuditStore(files, path)` | `append(events)` でスキーマ検証、既存行保存、ID 重複排除。破損・ID衝突は書かずに拒否 |
| `io.mjs` | `run(main, options?)` | stdin のサイズ・JSON・スキーマ・パスを検査し main を呼ぶ。例外は ID 付き stderr と終了0、遮断は理由付き終了2 |

`run()` は不正入力なら main を呼びません。未知のトップレベル入力フィールドを取り除き、`tool_input` のキーは各ツールの入力として保持します。1 MiB 以上は拒否します。パスの字句上の `../` だけでは判定せず、解決先と実在する祖先を検査します。

`HookMain` の返値は内部用です。正常時の stdout は空、遮断理由は stderr に出します。内部のイベントや `decision: allow` をハーネス向け JSON として直接出力しません。再開要約などのハーネス固有 JSON は後続のアダプタで定義します。

監査先は `RuntimeOptions.audit` で明示します。入力のパスやイベントの intent 名から書き込み先を作りません。events を返す main に監査先がなければエラーにし、記録に成功したように見せません。

ファイル更新は隣接するロックディレクトリ内に一時ファイルを作り、書き込みと sync の後で rename します。監査では既存のバイト列をそのまま先頭に残します。既存 ID の同一レコードは省略し、内容の異なるレコード、末尾改行の欠落、不正 JSON、既存の重複 ID は拒否します。バッチ全体を検証してから一度だけ置換するため、途中のレコードだけが残ることはありません。

ロックを取れない呼び出しは `FS-BUSY` で終了し、他の書き手のロックを削除しません。クラッシュで残ったロックを時刻から推測して自動削除する処理はありません。複数プロセスからの再試行・運用復旧はフック導入時の残件です。

このファイル境界は、事前に存在するリンクとパスの逸脱を防ぎます。同じ OS 権限を持つ別プロセスが検査と操作の間にディレクトリを差し替える攻撃を完全に防ぐ隔離機構ではありません。

## テストの境界

`fakeClock()` は時刻を固定します。`sandbox()` は一時ディレクトリだけに書き、終了時に削除します。プロセステスト用には Git リポジトリを初期化し、unit のファイル境界テストでは `git: false` を指定して子プロセスを起動しません。

`runHook()` は子プロセスの stdout・stderr・終了コードを観測します。版付き実機 fixture がないイベント種別は使用できません。手製の変種は `synthetic: true` を付け、同じハーネスとイベント種別に適格な実機例があることを要求します。不正入力6種は、適格な実機入力を基準に壊したケースとして検査します。

共通 io のテスト用 driver は製品フックではありません。driver で試した記録・遮断を、REG-2 の製品イベントの emit 実績には数えません。製品フックの時間予算、全27種の発火、実機でのハーネス出力の挙動は別途検証します。

## 実機記録

2026-09-27、Claude Code `2.1.280` の `--print` と専用 settings で `UserPromptSubmit` を記録しました。記録フックの exit 2 で、モデルに送信する前に処理を止めています。CLI が出力した原文と版番号を保存し、他イベントの実機記録へ流用しません。

採取方法は [Claude Code hooks reference](https://code.claude.com/docs/en/hooks#userpromptsubmit) の stdin と exit 2 に従います。Codex `0.153.4` の版は確認しましたが、新たな実機 payload は採取していません。[Codex のフック](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)には定義ごとの信頼確認があるため、既存9件の版番号をこの版で埋めません。
