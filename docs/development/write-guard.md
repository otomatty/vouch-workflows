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
| artifact | `vouch/intents/<intent>/intent.md`、`design.md` | 下書きはモデル（ファイル編集ツール）。approved への変更は #5 の正規経路（未実装）。承認済みの内容を変える主体はない | 現在 approved、または書き込み後に approved になり得る変更を拒否。シェルからの書き込みは内容を検証できないため下書きも拒否 |

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

FileStore の `locate(path, from)` は、実在する最も深い祖先を realpath で実体に対応付け、残りの要素を付け足します。記号リンク、junction、root の別名、8.3 短縮名は実体へ対応付けます。返すのは root からの正規の相対パス（外なら null）、root かその祖先を指すか、リンクを辿った後の種類、通常ファイルのリンク数です。リンクを拒否する `resolvePath` とは別の操作で、外・リンク・未作成のパスでも例外にしません。

区分の判定では、各要素を小文字にし、末尾のドットと空白、`:` 以降（NTFS の代替データストリーム）を除きます。Windows で同じファイルを指す綴りを、どの OS でも保護対象として扱います。Linux では過剰側に倒れます。glob の文字を含む要素は、その位置の名前に一致し得るものとして扱います。

次の場合は実体を確定できないので `VOUCH-GUARD-LINK` で拒否します。書き込みツールの対象と、読み取り専用でないシェルコマンドの語に適用します。

- 宛先のない記号リンク、循環するリンク
- リンク数が2以上の通常ファイル（ハードリンク）

プロジェクトの外のパスは保護対象ではありません。禁止リストにない書き込みは妨げません。ただし root やその祖先を指す語は、削除・移動・上書きコピーのコマンドで拒否します。

io.run は PreToolUse の時だけ、main の前に cwd と `tool_input.file_path` の包含を検査しません。`file_path` が文字列でない入力は、従来どおり HOOK-14 で main を呼びません。包含の失敗を fail-open の例外にすると、root 外の別名・リンク・予約名を経由した書き込みがガードを素通りするためです。io.run は検証済みの FileStore の `locate` を ReadyHookContext に渡し、分類は main が行います。他のイベントの検査は変えません。

## 承認済みの判定

`declaresApproved(text)` は、先頭（BOM 可）が `---` 行で始まる frontmatter の中に、`status: approved` の行があるかを判定します。大文字小文字、引用符、前後の空白、行末のコメントを許し、閉じる `---` がなければ末尾まで見ます。snapshotIntent が approved と読む文書はすべて含みます。

| ツール | 拒否する条件 |
| --- | --- |
| Write | 現在の内容、または新しい content が approved |
| Edit | 現在の内容が approved。old_string が現在の内容にあれば、置換の結果（replace_all を反映）が approved。見つからない、またはファイルがない時は、new_string に approved の行がある |
| apply_patch | 対象ごとに、現在の内容が approved、または Add の内容と Update の追加行に approved の行がある。Move は元と先の両方を判定する |
| Bash | 成果物を名指す読み取り専用でないコマンドは、内容を検証できないので `VOUCH-GUARD-ARTIFACT` で拒否する |

Edit で old_string が見つからない場合の判定は、ハーネスの引用符・改行の正規化との差を過剰側に倒すためのものです。現在の内容を読めない時（不正な UTF-8 など）は `VOUCH-GUARD-UNVERIFIED` で拒否します。

## シェルコマンドの判定

POSIX シェルの字句だけを近似します。PowerShell の構文や、実行時に決まる値は解釈しません。

1. 引用符とバックスラッシュを外して語に分け、`;`・`&`・`|`・括弧・改行で単純コマンドに分けます。`>`・`>>`・`&>`・`>|` などの出力先は語として残し、出力先が `/dev/null` と記述子の複製以外なら、そのコマンドを書き込みとします。`$(`、バッククォート、`<(`、`>(` は動的な構成とします。
2. 各語（`--opt=値` や `名前=値` の右辺も含む）を、保護対象の区分へ分類します。
   - cwd から解決した locate の結果。`cd` と `pushd` の引数が固定の語なら、以降の語の基点を移します。括弧の中の移動は括弧を出ると戻します。
   - 語そのものの要素の並び。`vouch/intents/<intent>/audit`、`vouch/intents/<intent>/intent.md`、`<配布ディレクトリ>/hooks` など、`audit/events.jsonl` の末尾、`.vouch-lock` を、変数や `~` を含む語、基点が分からない語でも探します。
3. 保護対象を名指し、コマンド全体が読み取り専用でなければ拒否します。
4. 削除・移動・コピーのコマンド（rm、rmdir、unlink、mv、cp、rsync、動作指定付きの find）が、root やその祖先、または保護対象を含むディレクトリを名指せば拒否します。

読み取り専用は、動的な構成がなく、すべての単純コマンドが次を満たすことです。

- 書き込みのリダイレクトと、先頭の変数代入がない。
- プログラムが `/` を含まない名前で、write-guard.json の readers にある。
- sort・find・rg・file は拒否するオプションがない。これらと sed・git は、`$` や glob の文字を含む引数を持たない。
- sed は `-n` 付きで、スクリプトが行番号範囲の `p` だけである。
- git は許可した大域オプション（`-C`、`--no-pager`、`-P`）とサブコマンドだけを使い、拒否するオプションがない。サブコマンドは作業ツリーのファイルを書き換えないもの（status、log、show、diff、blame、ls-files、rev-parse、cat-file、grep、add、commit）とする。
- node は、配布ディレクトリの hooks にある runtime.json の commands（doctor）を唯一の引数とする形だけとする。

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
| `VOUCH-GUARD-UNVERIFIED` | 成果物の現在の内容を読めない |

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
| パスを名指さない Git の作業ツリー操作（checkout、reset、stash、merge など）、ディレクトリ全体への整形ツール | 検査外（Git 操作は #6） |
| 登録していないツール、サブエージェントでの未採取の経路、Windows のシェル | 検査外または未検証 |
| ハーネスの外での人の編集、利用者・管理者の設定、CLI の `--settings` や Codex の信頼状態の変更 | 検査外 |
| 検査とツール実行の間の競合（他プロセスによるリンクの差し替え、同時の状態変更） | 防がない |

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
