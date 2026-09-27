# Claude の SessionStart 登録と配布

## 今回の契約

実装済みの `vouch-record-session-start.mjs` を Claude の `SessionStart` / `startup` に登録します。他のイベント、Codex、Skill、エージェント、doctor は今回の配布に含めません。

`harness/claude/manifest.mjs` はコピー元・コピー先の対応表です。`harness/claude/settings.json` は登録設定の正本です。設定は `env.VOUCH_HARNESS=claude` とフック登録だけを持ち、モデル・権限・プロバイダー設定は追加しません。コマンドは `node` と args 配列を使い、`${CLAUDE_PROJECT_DIR}` を含むスクリプトパスを一引数として渡します。

`readContext()` は明示された `VOUCH_PROJECT_ROOT` を優先します。値が未設定で、`VOUCH_HARNESS=claude` の場合だけ、Claude が子プロセスへ渡す `CLAUDE_PROJECT_DIR` を採用します。空文字や相対パスの明示設定は拒否し、別の値で救済しません。Codex にはこの補完を適用しません。stdin の cwd、intent、harness は信頼の根拠にしません。`VOUCH_INTENT` は利用者が起動前に指定し、未指定なら記録しません。

公式の [フック実行形式](https://code.claude.com/docs/en/hooks#exec-form-and-shell-form) と [スクリプトパス](https://code.claude.com/docs/en/hooks#reference-scripts-by-path) を参照しています。実機確認の対象はインストール済み Claude Code 2.1.280 です。旧版への互換性は未検証です。

## 生成コマンドの契約

`node scripts/package.mjs` は存在する manifest を読み、`dist/<harness>/` 以下へ対応表どおりにバイトをコピーします。コピー元は `core/` と `harness/` のみです。内容のハーネス分岐、日時の挿入、npm 実行時依存は持ちません。変換が必要な Skill・TOML の導入は後続です。

`--out <directory>` はテスト用に出力先の基点を変更します。`--check` は既存出力とのファイル集合・バイトの完全一致を検査し、欠落・変更・余分なファイルがあれば終了1にします。検査中はファイルを作成・修復しません。通常生成でも余分なファイルやシンボリックリンクを検出した場合は停止し、自動削除しません。引数の誤りは書き込み前に拒否します。

登録されたフックと配布された製品フックは両方向で一致させます。lib と registry は実行に必要な相対配置を保ち、配布へテスト・fixture・golden・node_modules を混入させません。配布を空の一時プロジェクトへコピーした子プロセステストで、監査ログの全文と再実行時の重複防止を確認します。プロジェクト名の空白・日本語・記号も検査します。

## 検証の区別

自動テストのイベントは既存の版付き SessionStart 実機 fixture に基づく synthetic として扱います。設定ファイルを読むテストや Node での直接実行を、Claude の実登録確認とは呼びません。別途、隔離した設定領域と空のプロジェクトで `claude --init-only` を実行し、生成した登録から実際に監査ログが生じることを確認します。実ユーザーの設定や移行元 fixture は変更しません。

Windows の性能不足は独立した残件です。同じ20回の子プロセステストを既存 Docker の Linux / Node.js 22.20.0 でも実行し、環境ごとの結果を記録します。200ms と1件5秒の基準は変更しません。配布の部分実装が通っても、Codex、doctor、全イベント、Skill・エージェントを含む DIST 要件の完了とはしません。
