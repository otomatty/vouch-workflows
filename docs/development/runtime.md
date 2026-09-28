# 共通ランタイムとテスト基盤

## 契約

前段の [レジストリ契約](contracts.md)に、次の API を追加します。フックの登録・成果物からの状態導出・人の承認の検証は別の実装です。

| モジュール | API | 契約 |
| --- | --- | --- |
| `clock.mjs` | `now()`, `newId(session, identity)` | UTC 時刻、セッションと入力識別子の決定的 ID |
| `env.mjs` | `readContext(env?)` | 明示された root・harness と任意の `VOUCH_INTENT` を読む。root・harness の未設定や不正値は拒否 |
| `validation.mjs` | `parseInput(text)`, `isAuditEvent(value)`, `isHookResult(value)`, `assertSupportedSchema(schema)` | 既存 JSON Schema の利用部分を依存ゼロで評価。ロード時に対応語彙を確認し、未知の構文はエラー |
| `fs.mjs` | `createFileStore(root)` | root 内の読み込み・原子的な更新。root を指す別名の絶対パスは実体の root に対応付け、root の中のシンボリックリンク・junction・複数リンクのファイルを拒否 |
| `audit.mjs` | `createAuditStore(files, path)`, `createIntentAuditStore(files, intent)`, `findEvent(store, id)` | `find(id)` は全ログ検証後に検索。`append(events)` はバッチをコピー・検証し、既存行保存と重複排除。破損・ID衝突は書かずに拒否 |
| `io.mjs` | `run(main, options?)` | stdin のサイズ・JSON・スキーマ・パスを検査し main を呼ぶ。例外は ID 付き stderr と終了0、遮断は理由付き終了2 |

フックの stdin・stderr と組み込みモジュールの読込は [記録フックの起動費用](hook-startup.md)で定めます。`run()` は不正入力なら main を呼びません。未知のトップレベル入力フィールドを取り除き、`tool_input` のキーは各ツールの入力として保持します。1 MiB 以上は拒否します。パスの字句上の `../` だけでは判定せず、解決先と実在する祖先を検査します。root と同じディレクトリを指す別の綴り（8.3 短縮名・junction・subst・記号リンク）の扱いは [root の別名と包含判定](root-alias.md)で定めます。

`HookMain` の返値は内部用です。正常時の stdout は空、遮断理由は stderr に出します。内部のイベントや `decision: allow` をハーネス向け JSON として直接出力しません。再開要約などのハーネス固有 JSON は後続のアダプタで定義します。

監査先は `RuntimeOptions.audit` で明示するか、設定元の `VOUCH_INTENT` から構成します。context と記録処理は同じストアを使います。入力のパスやイベントの intent 名から書き込み先を作りません。events を返す main に監査先がなければエラーにし、記録に成功したように見せません。

ファイル更新は隣接するロックディレクトリ内に一時ファイルを作り、書き込みと sync の後で rename します。監査では既存のバイト列をそのまま先頭に残します。不正 UTF-8 は置換文字で読み進めず拒否します。既存 ID の同一レコードは省略し、内容の異なるレコード、末尾改行の欠落、不正 JSON、既存の重複 ID は拒否します。バッチ全体を検証してから一度だけ置換するため、途中のレコードだけが残ることはありません。

ロックを取れない呼び出しは `FS-BUSY` で終了し、他の書き手のロックを削除しません。クラッシュで残ったロックを時刻から推測して自動削除する処理はありません。複数プロセスからの再試行・運用復旧はフック導入時の残件です。

このファイル境界は、事前に存在するリンクとパスの逸脱を防ぎます。同じ OS 権限を持つ別プロセスが検査と操作の間にディレクトリを差し替える攻撃を完全に防ぐ隔離機構ではありません。

## テストの境界

`fakeClock()` は時刻を固定します。`sandbox()` は一時ディレクトリだけに書き、終了時に削除します。プロセステスト用には Git リポジトリを初期化し、unit のファイル境界テストでは `git: false` を指定して子プロセスを起動しません。

`runHook()` は子プロセスの stdout・stderr・終了コードを観測します。版付き実機 fixture がないイベント種別は使用できません。手製の変種は `synthetic: true` を付け、同じハーネスとイベント種別に適格な実機例があることを要求します。不正入力6種は、適格な実機入力を基準に壊したケースとして検査します。

共通 io のテスト用 driver は製品フックではありません。driver で試した記録・遮断を、REG-2 の製品イベントの emit 実績には数えません。製品フックの時間予算、全27種の発火、実機でのハーネス出力の挙動は別途検証します。

## 実機記録

2026-09-27、Claude Code `2.1.280` の `--print` と専用 settings で `UserPromptSubmit` を記録しました。記録フックの exit 2 で、モデルに送信する前に処理を止めています。CLI が出力した原文と版番号を保存し、他イベントの実機記録へ流用しません。

採取方法は [Claude Code hooks reference](https://code.claude.com/docs/en/hooks#userpromptsubmit) の stdin と exit 2 に従います。Codex `0.153.4` の版は確認しましたが、新たな実機 payload は採取していません。[Codex のフック](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)には定義ごとの信頼確認があるため、既存9件の版番号をこの版で埋めません。

## 共通ランタイム導入時の検証記録

契約のコミットは `31f8dc7`、実装前テストは `3c9683c` です。実装前の unit は、6モジュールの `ERR_MODULE_NOT_FOUND` で失敗することを確認しました。その後に共通処理を実装しました。

2026-09-27、Windows / Node.js 24.13.0 の `npm run check` が38.4秒で成功しました。content 9件、registry 28件、unit 26件、transport 4件の計67件です。lib のカバレッジは行99.79%・分岐98.28%・関数100%で、95/95/100の基準を満たします。

Node.js 22.19.0 でも同じ `npm run check` が29.2秒で成功し、67件と同じカバレッジ基準を満たしました。どちらも Lint・型検査を含みます。製品フックのカバレッジは未測定です。

原仕様、`docs/aidlc-v2-reference/`、既存の Codex payload は変更していません。採取原文との JSON 値の一致と、手製の変種に synthetic が必要なことを検査します。ミューテーションスコアと Linux での実行結果は未測定です。

## セッション開始フック追加後の状態

`run(main)` を使う最初の製品フックで `session.started` の発火・再実行・失敗時の挙動を検査しています。ハーネスごとの登録・出力アダプタ、残り26イベントの発火、承認の真正性、監査の親子関係・計測、成果物からの状態導出は未実装です。Skill・エージェント・テンプレート・配布・移行処理・シナリオも残っています。現在の PC では p95 時間予算が未達です。[今回の検証記録](session-start.md)と `enforcement-map.json` に範囲を分けて記載しています。

次は性能基準を満たす実行条件と実装を確認したうえで、ハーネスへの登録を進めます。後続の UserPromptSubmit emitter で使う `prompt_id` は現行スキーマ外なので、その契約で定義します。同じ文面の別操作とリプレイを区別する必要があります。

## Claude 配布での更新

[Claude 配布](claude-distribution.md)で SessionStart の登録を追加しました。`readContext()` は `VOUCH_PROJECT_ROOT` が未設定かつ `VOUCH_HARNESS=claude` の場合だけ、Claude が渡す `CLAUDE_PROJECT_DIR` を採用します。空文字や相対パスの明示設定、Codex への補完は拒否します。stdin から信頼するルートや intent を推測する契約には変更していません。

`cwd` と `tool_input.file_path` は共通 io で検査します。その他のツール固有パス、シェルコマンド内のパス、プロジェクト外に置かれる transcript は、この段階では読み書きせず、対象のフックで別途契約を定義します。
