# 監査ログ・フック設定・承認済み成果物の書き込み保護

## 範囲と根拠

[Issue #4](https://github.com/otomatty/vouch-workflows/issues/4) の契約と検証記録です。決定記録 §4 の禁止リスト（監査ログの手書き・編集、人の承認なしの approved）と、§11 のフックの責務（承認の真正性、禁止リストの機械的部分）に従います。§18 の決定は変えません。

PreToolUse の製品フック `vouch-guard-writes.mjs` を追加します。フックは判断しません。ツール入力が保護対象を変え得るかを機械的に検査し、変え得る時だけ理由付きの終了2で遮断します。監査イベントは記録せず、ファイルも書きません。遮断の記録（hook.denied）は監査イベントの発火の課題（#12）で扱います。

approved への正規の更新経路と承認の真正性は #5、テストの削除・改変、main への push などの Git 操作の検査は #6 の範囲です。このフックは、ハーネスのツールから approved を作る書き込みと、承認済みの成果物を変える書き込みを遮るだけです。

## 保護対象と正規の更新主体

パスはプロジェクト root からの相対で示します。`<intent>` は任意の Intent 名です。配布ディレクトリ（Claude は `.claude`、Codex は `.codex`）は、フック自身のファイルの位置から決めます。stdin、環境変数の Intent、ツール入力からは推定しません。開発ツリーの `core/hooks/` から起動した場合、配布ディレクトリはプロジェクトの外にあり、配布物の保護は働きません。

| 区分 | 対象 | 正規の更新主体 | ハーネスのツールからの書き込み |
| --- | --- | --- | --- |
| audit | `vouch/intents/<intent>/audit/` とその下 | 製品フックの AuditStore。io.run から FileStore のロック・一時ファイル・rename で追記する | 内容や actor に関わらず拒否 |
| lock | 名前が `.vouch-lock` で終わる要素を含むパス | FileStore の updateText | 拒否 |
| installation | 配布ディレクトリの `hooks/`・`registry/` と、`registry/installation.json` の registration・configuration・overrides が名指すファイル | 配布物をコピーする人（ハーネスの外） | 拒否 |
| artifact | `vouch/intents/<intent>/intent.md`、`design.md` | 下書きはモデル（ファイル編集ツール）。intent.md の approved への変更は[承認の境界](approval-boundary.md)のレビュー記録フックだけ。承認済みの内容を変える主体はない | 現在 approved、または書き込み後に approved になり得る変更を拒否。シェルからの書き込みは内容を検証できないため下書きも拒否 |

installation.json の overrides は、登録を上書き・無効化できる同じディレクトリのファイルです。Claude は `settings.local.json` を持ちます。Claude の [フック文書](https://code.claude.com/docs/en/hooks) によると、設定ファイルのフックの直接編集はセッション中にも読み込まれ、`disableAllHooks` で無効化できます。登録ファイルの保護は、ガード自身を外されないためにも必要です。

正規のフックはハーネスのツールを通さずに自分のプロセスで書くため、このガードの対象になりません。ガードはロックを取らず、ファイルを作らないので、正規のフックの追記や既存のロックを妨げません。

## 対応ツールと検査可能範囲

一覧は `core/registry/write-guard.json` が正典です。登録の matcher は、[版付き fixture](harness-fixtures.md) で artifact-guard に分類した種別に限ります。

| ハーネス | ツール | 版付き fixture | 検査する入力 |
| --- | --- | --- | --- |
| Claude | Write | 2.1.280 Windows、2.1.283 Linux | `file_path`、`content` |
| Claude | Edit | 2.1.283 Linux | `file_path`、`old_string`、`new_string`、`replace_all` |
| Claude | Bash | 2.1.283 Linux | `command` |
| Codex | apply_patch | 0.153.4 Linux | `command` の `*** Add File:`・`Update File:`・`Delete File:`・`Move to:` 行と、`+` / `-` 行 |
| Codex | Bash | 0.153.4 Linux | `command` |

Claude は `"matcher": "Write|Edit|Bash"`、Codex は `"matcher": "apply_patch|Bash"` で登録します。Codex 0.153.4 で、この matcher が apply_patch と `exec_command`（tool_name は Bash）に発火し、終了2がツールを止めて理由をモデルに返すことを、固定応答の CLI で確認しました。Claude の文書は、サブエージェントのツール呼び出しにも同じフックが発火すると述べています。サブエージェントの PreToolUse は採取していません。

登録していないツールは検査しません。Claude 2.1.284 の Linux で `--print` が提供したツールには NotebookEdit と EnterWorktree があり、fixture がないので対象外です。MCP のツール、Codex の write_stdin など exec 内の他の関数、Windows の PowerShell ツールも同じです。

## パスの判定

ツール入力の `file_path`、パッチのパス、シェルの語は、どれも信頼しません。相対パスは入力の cwd を基点に解決します。cwd はハーネスが示す作業位置で、相対パスの基点にだけ使います。root の外でも判定は続けます。

FileStore の `locate(path, from)` は、実在する最も深い祖先を realpath で実体に対応付け、残りの要素を付け足します。`\` はその OS の読み方に従い、Windows では区切り、Linux と macOS では名前の一部です。記号リンク、junction、root の別名、8.3 短縮名は実体へ対応付けます。返すのは root からの正規の相対パス（外なら null）、root かその祖先を指すか、リンクを辿った後の種類、通常ファイルのリンク数です。リンクを拒否する `resolvePath` とは別の操作で、外・リンク・未作成のパスでも例外にしません。権限がない、リンクが循環する、名前が長すぎるなどの理由で調べられない要素も、未作成と同じく、調べられる最も深い祖先から判定します。1語でも例外になると、HOOK-2 の fail-open で同じコマンドの他の書き込みまで通るためです。

区分の判定では、各要素を小文字にし、末尾のドットと空白、`:` 以降（NTFS の代替データストリーム）を除きます。Windows で同じファイルを指す綴りを、どの OS でも保護対象として扱います。Linux では過剰側に倒れます。glob の文字を含む要素は、その位置の名前に一致し得るものとして扱います。

`\` を含むパスは、`\` を `/` に置き換えて読んだ位置と、その OS の読み方で locate が返す位置の両方で判定し、どちらかが保護対象なら拒否します。Linux と macOS では `\` は名前の一部で、`audit/..\x` は root の外へ戻らず `audit` の中の `..\x` というファイルになるためです。Windows では両方が同じ位置です。書き込みツールの対象とシェルの語の両方に適用します。

次の場合は実体を確定できないので `VOUCH-GUARD-LINK` で拒否します。書き込みツールの対象と、読み取り専用でないシェルコマンドの語に適用します。

- 宛先のない記号リンク、循環するリンク
- リンク数が2以上の通常ファイル（ハードリンク）

ファイル編集ツールでは、プロジェクトの外のパスは保護対象ではありません。禁止リストにない書き込みは妨げません。シェルの語は、次節のとおり実体の位置に加えて綴りの形でも判定するため、root の外でも保護対象と同じ形の語を名指すコマンドは拒否します。root やその祖先を指す語は、削除・移動・上書きコピーのコマンドで拒否します。

io.run は PreToolUse の時だけ、main の前に cwd と `tool_input.file_path` の包含を検査しません。`file_path` が文字列でない入力は、従来どおり HOOK-14 で main を呼びません。包含の失敗を fail-open の例外にすると、root 外の別名・リンク・予約名を経由した書き込みがガードを素通りするためです。io.run は検証済みの FileStore の `locate` を ReadyHookContext に渡し、分類は main が行います。他のイベントの検査は変えません。

## 承認済みの判定

`declaresApproved(text)` は、先頭（BOM 可）が `---` 行で始まる frontmatter の中に、`status: approved` の行があるかを判定します。大文字小文字、引用符、前後の空白、行末のコメントを許し、閉じる `---` がなければ末尾まで見ます。snapshotIntent が approved と読む文書はすべて含みます。

| ツール | 拒否する条件 |
| --- | --- |
| Write | 現在の内容、または新しい content が approved |
| Edit | 現在の内容が approved。old_string が現在の内容にあれば、置換の結果（replace_all を反映）が approved。見つからない、またはファイルがない時は、new_string に approved の行がある |
| apply_patch | 対象ごとに、現在の内容が approved、または Add の内容と Update の追加行に approved の行がある。Update は、現在の内容のどこかに approved の行があれば approved にし得るとみなす。Move は元と先の両方を判定し、先は元の現在の内容のどこかに approved の行がある時、または元を読めない時も approved にし得るとみなす |
| Bash | 成果物を名指す読み取り専用でないコマンドは、内容を検証できないので `VOUCH-GUARD-ARTIFACT` で拒否する |

Edit で old_string が見つからない場合の判定は、ハーネスの引用符・改行の正規化との差を過剰側に倒すためのものです。apply_patch は hunk を適用して結果を再現しないため、区切りの `---` 行の追加・削除で本文の `status: approved` 行が frontmatter に入る変更や、approved の行を含む別のファイルを成果物の位置へ移す変更を、現在の内容の行で過剰側に判定します。現在の内容を読めない時（不正な UTF-8 など）は `VOUCH-GUARD-UNVERIFIED` で拒否します。

## シェルコマンドの判定

POSIX シェルの字句だけを近似します。PowerShell の構文や、実行時に決まる値は解釈しません。

1. 引用符とバックスラッシュを外して語に分け、`;`・`&`・`|`・括弧・改行で単純コマンドに分けます。`>`・`>>`・`&>`・`>|` などの出力先は語として残し、出力先が `/dev/null` と記述子の複製以外なら、そのコマンドを書き込みとします。`$(`、バッククォート、`<(`、`>(` は動的な構成とします。
2. 各語（`--opt=値` や `名前=値` の右辺も含む）を、bash と同じ規則でブレース展開（`{a,b}`、英字の `{x..y}`）してから、保護対象の区分へ分類します。整数の列（`{1..9}`）は最初の値で代表します。数字だけでは保護対象の名前を綴れないためです。展開が1語で256通りを超える時は、語を確定できないものとして名指しに数えます。
   - cwd から解決した locate の結果。`cd` と `pushd` の引数が固定の語なら、以降の語の基点を移します。括弧の中の移動は括弧を出ると戻します。
   - 語そのものの要素の並び。`vouch/intents/<intent>/audit`、`vouch/intents/<intent>/intent.md`、`<配布ディレクトリ>/hooks` など、`audit/events.jsonl` の末尾、`.vouch-lock` を、変数や `~` を含む語、基点が分からない語でも探します。
   - 引用符とエスケープを解釈しない、空白・引用符・演算子で区切っただけの生の語。PowerShell や Windows のパスは `\` を区切りに使いますが、POSIX の字句ではエスケープとして消えるためです。生の語は名指しの検出にだけ使い、読み取り専用の判定には使いません。
   - 生の語からは、POSIX シェルと PowerShell のどちらでもコメントと読める `#` のコメントだけを除きます。`#` が先頭か空白・タブ・改行の直後にあり、それより前（除いたコメントを除く）が英数字、空白、タブ、改行、`_ . , : ; = + - / ! ? | & > ~ *` だけの場合です。コメントは次の制御文字か行区切りで終わるとみなします。引用符、`\`、`$`、括弧、波括弧、`<`、`%`、`@`、非 ASCII の文字が現れた後は除きません。PowerShell の `<# #>`、`--%`、`\"` や、bash の `((` の読み方の違いで、POSIX ではコメントでも実際には実行される部分を見逃さないためです。
3. 保護対象を名指し、コマンド全体が読み取り専用でなければ拒否します。
4. 削除・移動・コピーのコマンド（rm、rmdir、unlink、mv、cp、rsync、動作指定付きの find、読み取り専用でない git）が、root やその祖先、または保護対象を含むディレクトリを名指せば拒否します。`git rm -r`、`git checkout --`、`git restore`、`git clean` は、名指したディレクトリの下の監査ログを消すか巻き戻すためです。

読み取り専用は、動的な構成がなく、すべての単純コマンドが次を満たすことです。

- 書き込みのリダイレクトと、先頭の変数代入がない。
- プログラムが `/` を含まない名前で、write-guard.json の readers にある。
- sort・find・rg・file は拒否するオプションがない。これらと sed・git は、`$`・glob・`{` の文字を含む引数を持たない。
- sed は `-n` 付きで、スクリプトが行番号範囲の `p` だけである。
- git は許可した大域オプション（`-C`、`--no-pager`、`-P`）とサブコマンドだけを使い、拒否するオプションがない。サブコマンドは作業ツリーのファイルを書き換えないもの（status、log、show、diff、blame、ls-files、rev-parse、cat-file、grep、add、commit）とする。
- node は、配布ディレクトリの hooks にある runtime.json の commands（doctor・DoD・question・report）を最初の引数とし、続く引数が英数字と `-` だけの語である形だけとする（`ask Q-1` など）。展開・リダイレクト・パスを含む引数は読み取りとしない。

関数の定義、別名、以前のコマンドで変えた設定・環境は解釈しません。登録済みのフックを直接起動するコマンドは、配布ディレクトリを名指して node を使うため拒否されます。

## 理由と終了コード

| 理由 ID | 条件 |
| --- | --- |
| `VOUCH-GUARD-AUDIT` | 監査ログのディレクトリとその下、または root・`vouch`・Intent のディレクトリを削除・移動する |
| `VOUCH-GUARD-LOCK` | `.vouch-lock` を含むパス |
| `VOUCH-GUARD-INSTALLATION` | 配布ディレクトリの保護対象、またはそれを含むディレクトリを削除・移動する |
| `VOUCH-GUARD-APPROVED` | ファイル編集ツールで approved の成果物を変える、または approved にし得る |
| `VOUCH-GUARD-ARTIFACT` | 読み取り専用でないシェルコマンドが成果物を名指す |
| `VOUCH-GUARD-LINK` | 宛先を確定できないリンク、またはハードリンク |
| `VOUCH-GUARD-UNVERIFIED` | 成果物の現在の内容を読めない。または読み取り専用でないシェルコマンドの語で、ブレース展開が256通りを超える |

stderr は `<理由 ID>: <ツール> <対象>; <説明>` の1行です。対象は root からの相対パス、root の外なら入力の綴りです。io.run が終了2で返し、stdout は空です。複数に当たる時は表の上の行を優先します。

HOOK-2 に従い、不正な stdin、`VOUCH_PROJECT_ROOT`・`VOUCH_HARNESS` の設定誤り、予期しない I/O エラーは終了0の診断になり、ツールは止まりません。Codex で `VOUCH_PROJECT_ROOT` が未設定なら、登録コマンドのシェルが失敗し、Codex はツールを止めません（UserPromptSubmit で観測済みの挙動）。

## 検出・拒否できる範囲と限界

| 経路 | 扱い |
| --- | --- |
| 登録したツールで保護対象を名指す書き込み | 実行前に拒否する |
| リンク・root の別名・大文字小文字・末尾ドット・ADS を経由した同じ書き込み | 実体か正規化した名前で拒否する |
| 破損・重複 ID・スキーマ違反の監査ログ | 次の追記で AuditStore が AUDIT-CORRUPT / AUDIT-CONFLICT として拒否し、書き込まない（既存） |
| 監査ログへのハードリンク | 次の追記で FileStore が FS-LINK として拒否する（既存） |
| 登録の削除・改変 | 配布先 doctor の DOCTOR-REGISTRATION が手動実行時に検出する（既存） |
| 生成したスクリプト、変数、eval、設定、別名を介した間接的な書き込み | 検査外。形式の正しい偽の行や削除された行は検出できない |
| パスを名指さない Git の作業ツリー操作（checkout、reset、stash、merge など）、ディレクトリ全体への整形ツール | 検査外（Git 操作は #6）。パスを名指す読み取り専用でない git は削除系として判定する |
| 登録していないツール、サブエージェントでの未採取の経路、Windows のシェル | 検査外または未検証。読み取り専用の判定は POSIX の字句によるため、PowerShell で読み方が異なるコマンド（`\"`、`<# #>`、復帰文字で終わるコメント）では、書き込みを読み取りと誤り得る |
| ハーネスの外での人の編集、利用者・管理者の設定、CLI の `--settings` や Codex の信頼状態の変更 | 検査外 |
| 検査とツール実行の間の競合（他プロセスによるリンクの差し替え、同時の状態変更） | 防がない |
| root の外で保護対象と同じ形の語（別のプロジェクトの `vouch/intents/<intent>/audit`、`audit/events.jsonl`、`*.vouch-lock`）や、読み方の一致を確かめられないコメントの中の保護対象を名指すシェルコマンド | 過剰側に倒して拒否する。Git Bash は `/c/...` を `C:\...` と読み、Node.js の解決と一致しないため、実体が root の外に見える語も綴りで判定する |

このガードの拒否は、監査ログの内容が本物であることの証明ではありません。承認の判定（#5）は、監査の記録だけに頼らない設計が必要です。

## 検証の方法

契約・型、失敗する先行テスト、実装の順にコミットします。既存の fixture、golden、元仕様、移行元資料は変更しません。

- unit：locate の包含・別名・リンク・未作成パス、パッチとシェルの字句、区分の正規化、approved の判定、各ツールの判定を直接検査します。
- hooks：Claude 2.1.283 の Write / Edit / Bash と Codex 0.153.4 の apply_patch / Bash の Linux 採取から派生した synthetic 入力を runHook で実行します。所有外のファイルが不変であること、actor などの偽装、同じ入力の再送、破損した監査ログ・成果物、ロックの競合、許可される更新を負例・正例で検査します。
- scenario：配布物をコピーしたプロジェクトで、配布ディレクトリの保護と、正規のフックの追記が続くことを検査します。
- packaging：登録の matcher と write-guard.json のツール一覧の一致を検査します。
- 性能：検査系の p95 2秒未満を、20回の子プロセスと合成負荷で測ります。
- 実機：`scripts/check-write-guard.mjs` が、生成した配布を変更せずに隔離プロジェクトへコピーし、固定応答のプロバイダーが各ツールを要求します。拒否理由がツール結果としてモデルへ返ること、対象のバイトが変わらないこと、許可される更新と正規のフックの追記が行われることを観測します。対照として、登録から PreToolUse だけを外した実行で同じ要求が書き込みに至ることも観測します。スクリプト入力の観測であり、人の承認やモデル評価ではありません。

## 実機での確認の契約

`scripts/check-write-guard.mjs <claude|codex> <CLI の絶対パス>` は、生成した `dist/<harness>` を変更せずに隔離プロジェクトへコピーし、非対話 CLI を1回起動します。固定応答のプロバイダーが次のツールを順に要求し、次の要求に含まれるツール結果（モデルへ返る文）を記録します。`VOUCH_INTENT` を指定し、呼び出し元の `VOUCH_HARNESS` はもう一方のハーネス名にします。監査ログへの symlink `alias.jsonl` を起動前に置きます。

| ケース | Claude | Codex | 期待する観測 |
| --- | --- | --- | --- |
| audit-file | 監査ログへの Write（偽の行を含む） | 監査ログへの apply_patch | `VOUCH-GUARD-AUDIT` が返り、監査ログが変わらない |
| audit-shell | Bash で監査ログへ追記 | 同じ | 同上 |
| registration | 登録ファイルでフックを無効にする Edit | 同じ目的の apply_patch | `VOUCH-GUARD-INSTALLATION` が返り、登録ファイルが変わらない |
| approve | 下書きの status を approved にする Edit | 同じ内容の apply_patch | `VOUCH-GUARD-APPROVED` が返り、下書きが変わらない |
| link | `alias.jsonl` への Write | `alias.jsonl` への apply_patch | `VOUCH-GUARD-AUDIT` が返り、監査ログが変わらない |
| draft | 下書きの本文を変える Edit | 同じ内容の apply_patch | 理由が返らず、変更が反映される |
| read | Bash で監査ログを cat | 同じ | 理由が返らず、監査の先頭レコードの ID が返る |

実行後の監査ログは、SessionStart の正規のフックが記録した session.started 1件だけで、harness がそのハーネスであることも確かめます。偽の行は含みません。

終了2は、ツールが実行されず（対象のバイトが不変）、ツール結果に理由 ID が含まれることで確認します。フック自身の終了コードは CLI の外から観測できないためです。

対照として、コピーした登録から PreToolUse だけを外した実行（`--control`）も行います。理由が返らないこと、audit-file・audit-shell・approve の対象が書き換わることを確認し、ガードがなければハーネスが書き込むことを示します。link と registration は、ハーネス自身の保護の有無を記録するだけで、期待値を置きません。最初の試行で、Claude 2.1.284 は symlink への Write を自ら拒否し、Codex 0.153.4 は `.codex/` への apply_patch を自ら拒否したためです。

registration の編集は、ハーネスが設定として受け付ける内容にします。Claude は `disableAllHooks` を加える Edit、Codex は SessionStart の matcher を変える apply_patch です。存在しないイベント名への書き換えは、Claude が編集後の設定検証で拒否しました。

観測は `tests/fixtures/native/write-guard-linux.json` に保存し、`scripts/lib/write-guard-native.mjs` の純粋関数で packaging テストが照合します。スクリプト入力の観測であり、人の承認やモデル評価ではありません。Windows では起動を拒否し、確認済みとは扱いません。

## 検証記録

2026-09-29 に実装しました。契約は `ef727fd`、失敗する先行テストは `bf47e7c`、実装は `a13288a`、分岐を埋める追加テストは `baa6d53` です。実機確認の契約は `8baef61` と `77f0288`、先行テストは `11febda` と `6450320`、検証スクリプトは `9e01fda` です。

| 検査 | Linux / Node.js v22.22.2（`3541537`） |
| --- | --- |
| `npm run check` | 成功、33.1秒 |
| content / registry / packaging / scenario / unit / hooks | 33 / 53 / 35 / 13 / 130 / 49件成功 |
| 性能（合成負荷、各20回） | 記録 p95 76.8 / 69.1 / 77.6ms、ガード p95 74.9ms |
| lib 行 / 分岐 / 関数 | 全体 99.95 / 98.99 / 100%。areas・guard・shell・fs は各100% |
| フック行 / 分岐 / 関数 | vouch-guard-writes.mjs を含め 100 / 100 / 100% |
| 配布の生成と `package:check` | 140ファイルで成功 |

先行テストのうち2点は、実装の途中でテスト側を直しました。locate のテストでハードリンクの元にしたファイル自身もリンク数2になる準備の誤りと、予算ファイルを `recordP95Ms` だけで識別していた構造テストです。後者は検査系の `checkP95Ms` も対象に含めるよう広げ、規則は緩めていません。どちらも実装より前のテストのコミットに含めています。

lib 1ファイル300行の予算に収めるため、領域の分類と承認の判定を `areas.mjs` に分けました。`guard.mjs` は判定の組み立て、`shell.mjs` はシェルの字句、`words.mjs` はブレース展開とコメントの扱いです。

### CI で見つかった誤り

GitHub Actions の CI（Windows / Ubuntu × Node.js 22.19.0 / 24.x）の結果は次のとおりです。Ubuntu は両方の版で成功しました。

最初の push の Windows CI で、単体テスト1件が失敗しました。テストが `cd D:\a\...\audit` のように、引用符なしのバックスラッシュ区切りのパスをシェルのコマンドに入れていたためです。POSIX の字句ではバックスラッシュはエスケープで、実際の bash でも別のパスになります。テストは絶対パスを引用符で囲むよう直しました（`ae1acdf`）。

同じ読み方のため、PowerShell や Windows の `\` 区切りで監査ログや配布ディレクトリを名指すコマンド（Add-Content、Set-Content、Remove-Item など）を見逃すことも分かりました。再現テストを先にコミットし（`ae1acdf`）、引用符とエスケープを解釈しない生の語でも名指しを探すよう直しました（`9707532`）。

修正後の `da1f919` では、Windows / Node.js 22.19.0 が成功しました。Windows / Node.js 24.x は2件失敗しました。packaging の `NATIVE-NODE`（PowerShell からの node の探索が4秒の打ち切りに達した）と、記録系の p95（承認 200.2ms、セッション開始 206.5ms）です。どちらもガードの変更と関係しない既知の事象で、main の `79f536a` の CI でも同じ Windows / Node.js 24.x で記録の p95（レビュー開始 222.4ms）が失敗しています。予算と打ち切りは変更していません。Windows の CI でのガードの p95 は 166.6ms と 249.6ms で、検査系の2秒の予算内でした。その後の `d91e70b` の CI（run 36513641828）は、Windows・Ubuntu × Node.js 22.19.0・24.x の4ジョブすべてが成功しました。

### レビューとミューテーションで見つかった誤り

レビューで、installation.json の overrides が配列でないと文字列が1文字ずつ展開され、`settings.local.json` などが保護されないことが分かりました。再現テスト（`e0f88b7`）の後、形の正しくない記述を読めない記述と同じに扱い、配布ディレクトリ全体を保護するよう直しました（`d256006`）。

bash は語の途中の `a>(cat)` もプロセス置換として読みます。字句解析はこれを出力リダイレクトとして扱っていたため、再現テスト（`18c8a1c`）の後に直しました（`f72d36d`）。どちらの読み方でも読み取り専用とは判定されないため、判定の結果は変わりません。

### PR のレビューで見つかった誤り

PR（otomatty/vouch-workflows#22）への Devin のレビューは3点を指摘しました。その確認の過程で、指摘にない見逃しも2点見つかりました。

- locate が ENOENT・ENOTDIR 以外の lstat の失敗（循環するリンクの下の ELOOP、ENAMETOOLONG、EACCES）を例外にしていました。そうした語が1つあると HOOK-2 の fail-open でコマンド全体が通り、`echo x >> <監査ログ>; cat <300文字の名前>` で監査ログへ追記できました。
- bash のブレース展開（`{audit,b}`、`au{d,}it`、`aud{h..j}t`）を解釈せず、展開後に監査ログを指す語を見逃していました。
- 生の語が、コメントの中の保護対象の綴りも名指しとして数え、`echo ok > notes.txt # <監査ログ>` を拒否していました（指摘）。

契約（`a253a2e`）、失敗する先行テスト（`9d7106c`）、実装（`762c6e0`）の順に直しました。ブレース展開とコメントの処理は、shell.mjs を300行に収めるため `words.mjs` に置きました。先行テストのうち1件は、コミット前に直しました。`echo ok # x<CR>rm <監査ログ>` を拒否するという期待が、読み取り専用の判定は POSIX の字句によるという契約を超えていたためです。読み取り専用でない `Write-Output` を使う形にし、コメントを復帰文字の手前で切ることを確かめています。

指摘のうち2点は、挙動を変えずに理由を返しました。

- root の外で保護対象と同じ形の語の拒否（指摘）：実体が root の外にある絶対パスで綴りの判定を省くと、Windows で抜け道になります。Git Bash は `/c/...` を `C:\...` と読みますが、Node.js は現在のドライブの `\c\...` に解決するためです。過剰な拒否として限界の表に加え、「root の外は保護しない」と誤って書いていた記述を直しました。
- まだない保護対象を指すリンク（指摘）：宛先のない記号リンクは unresolved で、書き込みツールの対象と読み取り専用でないシェルの語では `VOUCH-GUARD-LINK` で拒否されます。これを確かめるテストを加えました。

PowerShell で POSIX と読み方が異なるコマンド（`\"`、`<# #>`、復帰文字で終わるコメント）では、読み取り専用の判定が書き込みを見逃し得ることも分かりました。Windows のシェルは検査外・未検証の範囲にあり、限界の表に明記しました。

同じ PR への CodeRabbit のレビューは、さらに3点を指摘し、どれも再現しました。

- Linux と macOS の `\` は名前の一部ですが、locate は `\` を区切りに置き換えていました。書き込みツールの `<監査ディレクトリ>/..\..\x` を root 直下と判定し、実際には監査ディレクトリの中にファイルができました。
- apply_patch の Move は移動先を追加行だけで判定し、approved の行を持つ別のファイルを成果物の位置へ移せました。閉じる `---` 行を消して、本文の `status: approved` 行を frontmatter に入れる Update も通りました。
- 読み取り専用でない git（`git rm -r`、`git checkout --`、`git restore`、`git clean`）が、root・`vouch`・Intent のディレクトリを名指しても拒否しませんでした。

契約（`b508318`）、失敗する先行テスト（`54fdc3c`）、実装（`293da75`）の順に直しました。locate は `\` をその OS の読み方で解決し、ガードが `/` に置き換えた読み方も別に判定します。先行テストに合わせ、`\` を常に区切りとした locate の既存のテストの1ケースを、新しい契約に沿って直しています。

修正後の `293da75` の `npm run check` は Linux / Node.js v22.22.2 で成功しました（33.0秒）。content / registry / packaging / scenario / unit / hooks は 33 / 53 / 35 / 13 / 142 / 50件、lib 全体の行 / 分岐 / 関数は 99.95 / 99.07 / 100%、areas・fs・guard・shell・words は各100%です。記録 p95 は 64.9 / 75.4 / 74.6ms、ガード p95 は 69.0ms、配布は142ファイルです。

修正後の push の CI では、Ubuntu のジョブはすべて成功し、Windows のジョブが2種類の理由で失敗しました。

- packaging の `NATIVE-NODE`：PowerShell から node を探す処理が4秒の打ち切りに達しました。`9eda3b6` の run 36517131533（再実行1回を含む）と、`ced7d76` の run 36517850692 です。
- HOOK-13 の承認記録の p95：`ced7d76` の Windows / Node.js 24.x で 206.1ms でした。

同じ `9eda3b6` の別の実行（run 36517135168）では、Windows を含む4ジョブすべてが成功し、node の探索は 2262ms でした。どちらもこの PR で変えていないコードの時間の打ち切りで、main の `79f536a` でも Windows / Node.js 24.x で記録の p95 が失敗しています。予算と打ち切りは変更せず、原因と修正案を PR に残しました。

### ミューテーション

Linux / Node.js v22.22.2 の Stryker 10 で、`areas.mjs`・`guard.mjs`・`shell.mjs` と `fs.mjs` の locate 部分（238〜287行）を測りました。設定はローカルの `reports/guard-stryker.config.mjs` で、commandRunner は4つの unit テストファイルを `--test-concurrency=1` で実行します。閾値の変更や変異の除外はしていません。

最初の測定は 1351変異中 1073件（timeout 55件を含む）を検出、278件が生存し、スコアは 79.42% で80%の基準を下回りました。生存変異のうち、冗長で結果を変えない条件（二重の演算子の読み飛ばし、空の here-document の処理、readers にない綴りの事前判定、`.`・`..` の特例、リンクの ancestor 判定）を挙動を変えずに削り（`fc88ac6`）、残りに対するテストを加えました（`3541537`）。

2回目は 1274変異中 1200件（timeout 57件を含む）を検出し、スコアは 94.19% です。内訳は areas 92.94%、guard 92.25%、shell 95.45%、fs の locate 100% です。生存74件の主な内訳は次のとおりです。

- 値がない時の既定値（`?? ""`、空の配列、target の初期値）の置き換えで、結果が変わらないもの
- 同じ保護対象を、シェルの語・生の語・語そのものの綴りの複数の経路で検出するため、1経路の変異では結果が変わらないもの（`cd` の後の基点が分からない場合の扱いなど）
- 位置の検索結果のキャッシュの削除、here-document の読み取りの境界、glob の文字クラスの細部、正規表現の端の指定

PR のレビューへの修正後は、変更した `words.mjs`・`guard.mjs` と `fs.mjs` の locate 部分（238〜294行）を、同じ設定に `words.test.mjs` を加えて測りました（ローカルの `reports/review-stryker.config.mjs`）。最初は 646変異中 587件（timeout 27件を含む）を検出、生存59件で、スコアは 90.87% でした。生存変異のうち、テストの不足が原因のものにテストを加えました（`a4b6572`）。不足していたのは、列の本体の前後の余分な文字、2桁の増分、後ろの空白だけでコメントになる `#`、展開の上限の理由の文、区切りとして読んだ `\` がリンクを通る場合です。

2回目は 646変異中 597件（timeout 27件を含む）を検出し、スコアは 92.41% です。内訳は fs の locate 95.74%、guard 91.47%、words 93.94% です。生存49件の主な内訳は次のとおりです。

- 結果が変わらない等価な変異（`{a..a}` の向き、比較の `<` と `<=` の境界、正規表現が両方の英字を同時に捕えること）
- 過剰側の判定が重なり、1経路の変異では結果が変わらないもの（ファイルでない移動元の判定、`\` を区切りとして読む前の置き換え、cwd の追跡）
- 前回から残る既定値と、配布の記述の読み取りの細部

lib 全体の変更前スコアは測っていないため、全体で生存変異が増えていないとは主張しません。夜間 CI の測定は未実装のままです。

### 実機での確認

`3541537` の配布を、Linux / Node.js v22.22.2 で `scripts/check-write-guard.mjs` により確認しました。Claude Code は環境に導入済みの 2.1.284 で、fixture の採取版（2.1.283）とは異なります。Codex は npm の `@openai/codex@0.153.4` をセッションの作業ディレクトリに導入しました。どちらも非対話の1回の起動で、固定応答のループバックのプロバイダーを使い、外部のモデルへの要求は送っていません。観測は `tests/fixtures/native/write-guard-linux.json` にあります。

PR のレビューへの修正後の `9eda3b6` の配布でも、同じ2つの CLI で4通りすべてを実行し直しました。どの観測も `3541537` と同じで、違うのは実行ごとの ID と所要時間だけです。fixture は `9eda3b6` の観測に置き換えました（`ced7d76`）。

| ハーネス | 登録 | 結果 |
| --- | --- | --- |
| Claude Code 2.1.284 | 変更なし | 拒否の5ケースすべてで理由 ID が返り、対象は不変。draft は反映、read は監査を返した。監査は起動フックの session.started（harness:claude）1件 |
| Claude Code 2.1.284 | PreToolUse なし | audit-file・audit-shell・approve が書き込まれた。link は CLI が symlink への Write を拒否、registration は acceptEdits でも `.claude/settings.json` への書き込み許可を求めて止まった |
| Codex 0.153.4 | 変更なし | 拒否の5ケースすべてで理由 ID が返り、対象は不変。draft は反映、read は監査を返した。監査は session.started（harness:codex）1件 |
| Codex 0.153.4 | PreToolUse なし | audit-file・audit-shell・link・approve が書き込まれた。link は symlink を通して監査ログに届いた。registration は CLI が「writing outside of the project」として拒否した |

モデルへ返った文は、Claude が「PreToolUse:<ツール> hook error: [node ${CLAUDE_PROJECT_DIR}/.claude/hooks/vouch-guard-writes.mjs]: <理由>」、Codex が「Command blocked by PreToolUse hook: <理由>. Command: ...」でした。どちらも CLI の終了コードは0です。

registration の対照は、ハーネス自身の保護を示すだけで、フック設定が安全という意味ではありません。Claude は許可ルールや bypassPermissions があれば書き込み、Claude の文書によると設定の変更はセッション中に読み込まれます。Codex の拒否は、承認方針が never でサンドボックスが workspace-write の exec で観測したものです。

確認していない範囲は次のとおりです。

- Windows と macOS、対話 CLI、他の CLI の版での実機確認。検証スクリプトは Windows で起動を拒否する。
- サブエージェントのツール呼び出し、NotebookEdit・EnterWorktree・MCP のツール、Codex の write_stdin。
- Codex で `VOUCH_PROJECT_ROOT` が未設定のときの PreToolUse。UserPromptSubmit では登録コマンドが失敗し、Codex は止まらなかった。
