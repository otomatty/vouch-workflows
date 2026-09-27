# ツールイベントの採取

2026-09-27、採取時 HEAD eb5bbc5。Claude Code 2.1.280 の隔離された --print 起動から Write の PreToolUse / PostToolUse を各1件採取しました。raw JSONL のバイトを claude-2.1.280-write.jsonl にコピーし、payload を変更せず harness/claude の2ファイルへ包装しています。

reports/tool-capture/claude 以下のプロジェクト・CLAUDE_CONFIG_DIR・設定を使いました。既存設定や認証情報は引き継がず、固定応答を返すループバック HTTP サーバーを ANTHROPIC_BASE_URL に指定しました。応答内のツール要求は手製ですが、保存したフックの stdin はインストール済み CLI が実際の Write 前後に生成した値です。実モデルの応答品質、人の承認、実運用プロジェクトの検証ではありません。経路や本文のエスケープも原文のままです。

実行した採取スクリプトは tool-capture/claude.mjs に保存しました。新規採取先のみで実行でき、既存 raw があれば停止します。引数 --restricted / --strict-mcp-config / --no-session-persistence / --tools Write / --allowedTools Write / --permission-mode acceptEdits を指定しています。記録用フックは一時設定だけに登録しました。外部モデルへの要求は送っていません。

Codex CLI 0.153.4 も独立した CODEX_HOME とプロジェクトで試しました。hooks/list の currentHash を確認して対象フックだけを信頼し、ループバックの固定 Responses 応答を渡しました。apply_patch は read-only sandbox、定数を出力する exec_command は policy により拒否され、raw は生じませんでした。Codex の版付き PreToolUse / PostToolUse を採取済みとはしません。診断ログでは -s workspace-write を指定した起動も ReadOnly と表示されていました。ポリシー変更やバイパスは行っていません。

Codex の試行スクリプトは tool-capture/codex-attempt.mjs に保存しました。ツール定義なしの要求の扱い、信頼キー、固定応答の調整を経ています。実機イベントの代用として応答の tool call を fixture へ転記していません。CLI セッションは終了しました。
