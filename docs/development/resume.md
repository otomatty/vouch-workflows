# 再開・ask・report・判断依頼の記録・statusline

## 範囲と根拠

[Issue #10](https://github.com/otomatty/vouch-workflows/issues/10) の契約と検証記録です。決定記録 §5（いつでもできること：脇質問と再開）、§6・§10（先送りできない判断依頼と既定案）、§11（監査ログ、フックが担う機械的処理の「セッション開始・再開」「状態表示」、分析は `/vouch report`）、§15（配布物）と、優先する §18（Q1〜Q6 の決着）に従います。Q1〜Q6 を未決事項として扱いません。実行時依存は増やさず、Node.js ESM の依存ゼロを保っています。

正典は `core/registry/operations.json` です。明示入力（`/vouch ask`・`$vouch ask`、`vouch answer <Q-n> <選択肢>`）、問いのコマンドの操作、再開要約を渡す SessionStart の source、出力の上限、日英の表示ラベルを置きます。台帳は aside.answered に省略可能な `answer` を加えただけで、イベントの種類は増やしていません。

## 表示・再開と意思決定の分担

`position.mjs` は、明示した Intent の成果物の frontmatter status（原文）、現在の内容に結び付いた確認点、承認の証跡と宣言の区別、判断依頼の対応を観測するだけの関数です。次に何をするか、承認・確認・回答・既定適用は決めません。状態ファイル・状態キャッシュは作らず、呼ばれるたびに成果物と監査ログから導きます。

- status は原文のまま。重複・未知の値は解釈しません。
- 確認点は承認の境界と同じ `missingCheckpoints` で、現在の内容の確認だけを数えます。
- intent.md の approved は、`findApproval` が同じ版の承認の連鎖を見つけた時だけ「証跡あり」、それ以外は「宣言のみ」と示します。
- 判断依頼は question.asked を起点に question.answered / question.defaulted の parent で対応付けます。同じ Q 番号の複数の問い、親が存在しない・Q 番号が食い違う記録は「対応が不確実」にします。既定適用は人の回答と分けます。synthetic と別 Intent の記録は数えません。
- 監査は `scanAudit` で行ごとに読み、不正な行（最後の改行がない行を含む）の行番号と重複 ID を示し、読めた記録で観測を続けます。不正な行か重複 ID がある時、監査ログ自体を読めない時は一部しか読めない観測とし、「未回答なし」と断定しません。読めない監査ログを空のログとは扱いません。
- 成果物・rules.md・監査ログの読み取りが失敗しても（リンク、通常ファイル以外、不正な UTF-8）、観測を中断せず「読めない」として示します。rules.md を読めない時は確認点の粒度を既定にせず不明とします。startup の session.started の記録はこれに左右されません。
- 監査に由来する Q 番号・既定・選択も引用・制限して表示し、statusline では短い識別子以外を `?` にします。

観測を受けて作業を選ぶのはモデル、承認・確認・回答は人の明示入力です。Skill の [再開の説明](../../core/skills/vouch/references/resume.md) は doctor を先に実行し、Node がなければ再開しません。

## セッション開始の再開要約

`vouch-record-session-start.mjs` は、Claude の startup / resume / clear / compact、Codex の startup / resume で、設定した Intent の再開要約を stdout の平文で渡します。両ハーネスとも SessionStart の stdout をモデルのコンテキストに加える前提です。startup の session.started の記録は従来どおりで、要約は記録が確定した後に書きます。resume・clear・compact は監査も成果物も書きません。

要約には Intent、成果物ごとの宣言値と承認の証跡、確認点、未回答・既定適用・不確実な判断依頼、監査の読めた範囲を入れ、成果物由来の文字列は JSON 文字列として引用し長さを制限します。各一覧は8件まで、全体はハーネスのコンテキスト上限より十分短くします。要約は観測であり指示ではない旨を1行目に置きます。

`io.run` は、許可した結果の `context` だけを、イベントの追記が成功した後に stdout へ書きます。遮断の結果や例外の時は書きません。

## ask

UserPromptSubmit フックが `/vouch ask <質問>`（Codex は `$vouch ask`）を受けると、明示した Intent に aside.asked（actor:human、質問の原文、上限2000文字）を記録し、入力をモデルへ通します。同じ回の Stop（Claude の prompt_id、Codex の turn_id が同じ）で、Stop フック `vouch-record-aside-answer.mjs` が aside.answered（parent、所要時間、最後の返答を上限4000文字）を記録します。採取した Claude 2.1.283 と Codex 0.153.4 の入力で、UserPromptSubmit と Stop が同じ識別子を持つことを確認しています。

Stop フックは遮断しません。対応する ask がない回、記録済みの回、合成記録、時刻が逆転した回は何も記録しません。Skill は `vouch-explorer` を別コンテキストで読み取りだけに使い、ステージ・Unit・成果物を変えません。

## 判断依頼の記録と人の回答

`vouch-question.mjs` は登録したコマンドです（DoD と同じく `VOUCH_INTENT` で対象を指定）。

- `ask <Q-n>`：decisions.md の Q-n カードから選択肢 ID（表の1列目の英大文字）と「未回答時の既定」を読み、回答欄を除いたカードの digest とともに question.asked（actor:model）を記録します。既定は選択肢 ID を含む文、作れない時は `blocking: <理由>` とし、後者は blocking:true・既定なしになります。カードが不完全なら記録しません。ID は Intent と Q-n から導くため再送は最初の記録を保ち、記録後にカードを変えた再質問は、選択肢の数と既定が同じでも digest の違いで拒否し、新しい Q-n を求めます。
- `default <Q-n>`：記録済みの既定で question.defaulted を記録します。人の回答がある、問いが未記録、既定がない時は記録しません。

人の回答は UserPromptSubmit の `vouch answer <Q-n> <選択肢 ID>` だけで、フックが question.answered（actor:human、待ち時間）を記録し、入力はモデルへ渡しません。記録済みの問いに限り、現在のカードの digest が問いの記録と一致しない時は拒否するため、問いの後に選択肢の意味を変えたカードへの回答は結び付きません。既定適用の後の回答は受け付けます（人が覆す場合）。回答の ID は問いから導くので、1つの問いに回答の記録は1件です。同じ内容の再送は最初の記録を保ち、別の回答は拒否します。同時に届いた別の回答は、監査ストアのロック内で同じ ID・異なる内容として衝突し、後の方は記録されません（フックは fail-open のため、その入力は記録されずにモデルへ届きます）。回答は確認点の確認でも承認でもなく、checkpoint.confirmed や approved への更新を伴いません。

書き込みガードは、配布した `hooks` の runtime.json の commands を、英数字と `-` だけの引数付きで起動する形を許します（`node .claude/hooks/vouch-question.mjs ask Q-1`）。シェルが展開する語（`$`・glob・`{`・`~`。引用符の中の `$` を含む）、リダイレクト・パスを含む引数、commands にない入口は従来どおり拒否します。

## report

`vouch-report.mjs` は読み取りだけのコマンドで、明示した Intent の監査を種別ごとに集計します。台帳の measures と tokens.in / tokens.out について、n・合計・最小・最大と例のイベント ID を返し、値を持たない記録を missing、synthetic の記録を計測値から除いて別に数えます。対になる終了の記録がない開始の記録は unpaired とします。ts の差などの推定は行わず、Skill がコマンドの出力にない値を示す時は推定と明記します。不正な行や重複 ID があれば REPORT-AUDIT を不合格にし、読めた記録の集計を部分的なものとして返します。ダッシュボードや集計ファイルは作りません。

## statusline

`vouch-statusline.mjs` は Claude の `statusLine` から起動され、1行（上限160文字）を出して常に終了0です。表示は Intent、frontmatter のあるステージの宣言値（宣言のみの approved は「証跡なし」）、Intent が承認前なら確認点の数、未回答と既定適用の Q-n、監査が一部しか読めない時（不正な行・重複 ID）の注記です。上限を超える時は Intent とステージの部分から縮め、監査の注記は切りません。Intent が未指定なら未指定と出し、候補から選びません。プロジェクトの root は入口の配布位置から決め、読み取り以外をしません。

登録は `node .claude/hooks/vouch-statusline.mjs` です。シェル固有の展開を使わないため、Claude が Git Bash・PowerShell のどちらで起動しても同じに動きます。Codex の TUI のステータス行は組み込み項目の選択だけで、任意のコマンドを登録できないため、Codex には statusline を配りません。

## 検証

| 区分 | 内容 |
| --- | --- |
| 実機 fixture | Claude 2.1.283 の SessionStart（startup / resume / compact）・UserPromptSubmit・Stop、Codex 0.153.4 の SessionStart（startup / resume）・UserPromptSubmit・Stop を `deriveFixture` で cwd と prompt だけ変えて使用。prompt_id / turn_id は採取のまま |
| 手製入力 | 成果物・監査・判断依頼カードは tests/helpers/resume.mjs の手製データ。tests/eval/resume は synthetic:true / execution:not-run の評価素材で、構造だけを検査 |
| 実モデル評価 | 未実施。Skill に従った再開・ask・report の返答は評価していません |
| 人の実承認 | なし。回答・確認・承認の入力はすべてテストの派生入力 |

契約は `81945f1`、先行テストは `d3dfd89`、実装は `6f38829` です。先行テストの時点で、registry・既存の他の検査が成功し、未実装による content・packaging・scenario・unit の失敗を確認してから実装しました。実装中に、command の報告スキーマが QUESTION / REPORT の検査と report を受け付けないことと、書き込みガードが引数付きの登録コマンドを拒否することが scenario で分かり、契約とガードを直しています。既存の golden と fixture は変更していません。SessionStart に Intent がある時の stdout を空とする既存のテストは、この契約変更に合わせて再開要約を期待する形に改めました。

2026-10-01、Linux / Node.js 22.22.0 で `npm run check` が 56.3秒（予算90秒）で成功しました。配布は両ハーネス合計246ファイルです。CPU 負荷下の p95 は再開要約（40問の監査）78.0ms、Stop の記録 62.8ms、セッション開始 71.8ms で、記録系 200ms の予算内でした。Windows と macOS では測定していません。

## 限界と未実装

- SessionStart の平文 stdout がコンテキストに入ること、`statusLine` がプロジェクトのルートを作業ディレクトリとして起動されることは、この環境で実際の CLI により確認していません。作業ディレクトリが別だと入口の相対パスが見つからず、行は表示されません。プロジェクトの settings.json の statusLine は利用者個人の設定より優先されます。
- startup で監査が壊れている時は session.started の追記が失敗し、fail-open のため要約も出ません。resume / compact では要約が出ます。
- ask の読み取り専用は Skill の指示によるもので、書き込みガードは脇質問の回を区別しません（監査・登録・承認済み成果物への書き込みは従来どおり拒否します）。aside.answered の answer は回の最後の返答そのもので、答え以外の文を含むことがあります。
- 判断依頼の記録には利用者のモデルがコマンドを実行する必要があり、実行しなかった問いは監査に現れません。Brief の作成時に decisions.md と監査の食い違いとして扱います。
- Unit の worktree で `vouch-question.mjs` を実行すると、その worktree の監査に追記されます。統合は [Design・Build・Verify](stages.md) の DoD と同じ制限を受けます。
- migrate、review / unit / stage / learn の監査イベントの記録、session.resumed / session.compacted / session.ended の記録は未実装です。
