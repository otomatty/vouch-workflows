# Linux の実機採取

2026-09-28、採取時 HEAD `8c975f3`（fixture 自体のコミットではありません）。Linux コンテナ（カーネル 6.18）と Node.js v22.22.2 で、インストール済みの CLI から記録用フックの stdin を採取しました。採取スクリプトはこのディレクトリの `claude.mjs` と `codex.mjs` です。どちらも新しい出力先でだけ動き、既存の出力先があれば停止します。出力先は `reports/capture/` 以下で、配布とコミットの対象外です。

共通の条件は次のとおりです。

- 出力先ごとに Git プロジェクト、設定領域、HOME を新しく作る。
- 引き継ぐ環境変数は PATH と固定の LANG・TERM だけにする。認証情報、プロキシ、既存の設定は引き継がない。
- プロバイダーは、固定応答を返すループバックの HTTP サーバーにする。外部のモデルへの要求は送っていない。
- 記録用フックは stdin の JSON 値を1行ずつ追記し、常に終了0で戻る。一時設定にだけ登録する。
- 原文 JSONL は、出力先の `raw.jsonl` をバイト単位でコピーしたもの。包装は、原文の行と payload が同値。

## Claude Code

`/opt/claude-code/bin/claude --version` は `2.1.283 (Claude Code)` でした。コンテナにあらかじめ導入された CLI です。一時の `--settings` で11イベントに記録用フックを登録しました。この11イベントには hook-input の契約外のイベントも含まれます。

どの起動でも `--model vouch-capture-model` を指定しました。payload の `model` と `resolvedModel` には、この架空の値が入ります。これは、CLI 既定のモデル識別子を fixture に残さないための指定です。ループバックのプロバイダーはモデル名を検証しません。最初の採取では既定のモデル名が payload に入ったため、同じ HEAD で採取し直しました。

`claude-2.1.283-linux-print.jsonl` は `node tests/fixtures/captures/linux/claude.mjs <CLI> <出力先> print` で採取した28行です。次の3回の起動で得ました。

1. `--print --model vouch-capture-model --restricted --strict-mcp-config --settings --tools Write,Edit,Bash,Agent --permission-mode acceptEdits --max-turns 8`。固定応答が Write、Edit、Bash（`echo vouch-capture`、`false`）、Agent を順に要求する。
2. 同じセッションを `--resume` し、`Resume capture.` を送る。
3. 同じセッションを `--resume` し、`/compact` を送る。

`claude-2.1.283-linux-tty.jsonl` は、同じスクリプトの `tty` で採取した6行です。util-linux の `script(1)` で 120×40 の疑似端末を作り、`--model vouch-capture-model --restricted --strict-mcp-config --settings --tools AskUserQuestion` で対話 CLI を起動しました。隔離した設定領域には `.claude.json` を置き、初回案内の完了、このプロジェクトの信頼、fixture 用キーの承認だけを記録しました。質問への回答は、スクリプトが入力した `1` と Enter です。

観測した挙動は次のとおりです。

- `--restricted` は `--tools` で指定しない限り Bash を外す。同日の試行で、Bash を指定せずに Bash を要求した時はフックが呼ばれなかった。
- 終了1の Bash は PostToolUse ではなく PostToolUseFailure で届く。
- Agent は非同期に起動する。完了は SubagentStop と、`<task-notification>` を本文とする UserPromptSubmit で届く。Agent・SubagentStart・Stop・SubagentStop の順序は試行ごとに前後した。
- `/compact` は PreCompact、`agent_type` が空文字の SubagentStop、source: compact の SessionStart、PostCompact を生んだ。
- 対話 CLI の permission_mode は `auto` だった。CLI の既定値で、指定はしていない。対話 CLI と compact の SessionStart には `model` が入る。

## Codex

npm の `@openai/codex@0.153.4`（linux-x64 の同梱バイナリを含む）をセッション用の作業ディレクトリへ導入しました。グローバルには導入していません。`bin/codex.js` を絶対パスで起動し、`--version` は `codex-cli 0.153.4` でした。

隔離した CODEX_HOME の `config.toml` では、次の設定だけを行いました。

- ループバックのプロバイダーを使う。
- hooks を有効にし、plugins・remote_plugin・analytics・起動時の更新確認を無効にする。
- 隔離プロジェクトを trusted にする。

記録用フックは CODEX_HOME の `hooks.json` に10イベントで登録しました。app-server の `hooks/list` が返した定義のうち、記録用コマンドと一致するものの currentHash だけを `hooks.state` に信頼登録しました。`--dangerously-bypass-*` 系のオプションは使っていません。

サンドボックスは `-s workspace-write` です。CLI は `sandbox: workspace-write [workdir, /tmp, $TMPDIR]` と表示しました。PATH に bubblewrap がないため、同梱の bubblewrap を使うという警告も表示しました。ターンのメタデータでは sandbox は `seccomp` でした。

0.153.4 は、ツール定義を要求の `input` の `additional_tools` で渡します。apply_patch と exec_command は、custom ツール `exec` の JavaScript から `tools.apply_patch()`・`tools.exec_command()` として呼ばれます。固定応答はこの形式で apply_patch、`echo vouch-capture`、`false`、`spawn_agent`、`wait_agent`、`request_user_input` を要求しました。

| 原文 | 起動 | 行数 |
| --- | --- | --- |
| `codex-0.153.4-linux-exec.jsonl` | `codex exec -s workspace-write -C <project> <prompt>`、続けて `codex exec resume <session> 'Resume capture.'` | 19 |
| `codex-0.153.4-linux-tty.jsonl` | 疑似端末で `codex --no-alt-screen -a never -s workspace-write -C <project> <prompt>`。Stop の後に `/compact` と Enter を別々に入力 | 18 |
| `codex-0.153.4-linux-plan.jsonl` | 同じ対話 CLI をプロンプトなしで起動し、Shift+Tab で Plan モードにしてから入力。質問には `1` と Enter で回答 | 5 |

観測した挙動は次のとおりです。

- 対話 CLI の system スレッド（タイトル生成）もプロンプトを含む要求を送る。固定応答は `thread_source: user` の要求にだけツール要求を返す。
- permission_mode を持つ行は、すべて `bypassPermissions` だった。承認方針は never（exec の既定、対話 CLI では `-a never`）で、バイパス用のオプションは渡していない。
- 名前空間付きのツールは、tool_name が `collaborationspawn_agent` のように名前空間と連結される。
- 終了1のコマンドも PostToolUse で届き、tool_response は空文字で終了コードを含まない。
- `request_user_input` は Default モードで PreToolUse の後に「request_user_input is unavailable in Default mode」で拒否され、PostToolUse は出ない。Plan モードでは質問が表示され、回答が tool_response に入る。
- `/compact` の後に出たのは PreCompact と PostCompact で、SessionStart は出なかった。
- 非対話の exec でも、SessionStart・UserPromptSubmit・ツール・Stop のフックが発火した。Windows の同じ版で以前に採取できなかった結果（[Codex 配布](../../../../docs/development/codex-distribution.md)）を、Linux の結果で置き換えるものではない。

## 包装と区別

包装は `tests/fixtures/harness/claude/2.1.283/linux/<print|tty>/` と `tests/fixtures/harness/codex/0.153.4/linux/<exec|tty|plan>/` にあります。key は原文の中で同じイベント・ツールの行を数えた位置です。一覧は [inventory.json](../../harness/inventory.json) です。hook-input の契約外の行は、原文にだけ残します。該当するのは SessionEnd、SubagentStart、PostToolUseFailure、PostCompact、空の `agent_type` を持つ SubagentStop です。

固定応答のツール要求は手製です。保存した stdin は CLI が生成したものです。モデル評価、人の回答・承認、配布登録の実行確認には数えません。配布登録の確認は[版付き fixture と伝播の検証](../../../../docs/development/harness-fixtures.md)で別に行います。
