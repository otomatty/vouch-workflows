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

## 配布と実機確認

契約は `435bf17`、実装前に失敗を確認したテストは `12ed4ad` です。生成スクリプトは現在113行で、manifest の指定した33ファイルをコピーします。

```sh
node scripts/package.mjs
node scripts/package.mjs --check
```

`dist/claude/` の内容を空のプロジェクトへコピーすると、`.claude/settings.json`、`.claude/hooks/`、`.claude/registry/` が配置されます。既存プロジェクトへ自動インストール・設定マージする機能はありません。`check` はテスト成功後に配布を生成して検査します。性能検査で止まる環境では、上のコマンドで配布部分を独立して検証できます。

2026-09-27、Windows / Claude Code 2.1.280 で、空白を含む一時プロジェクトと独立した `CLAUDE_CONFIG_DIR` を用意しました。生成設定のバイトを変更せず、次の形式で起動しています。

```powershell
$env:VOUCH_INTENT = '260927-installed'
claude --init-only --restricted --strict-mcp-config --settings '<project>/.claude/settings.json'
```

呼び出し元の `VOUCH_PROJECT_ROOT` と `VOUCH_HARNESS` は未設定です。終了0、`vouch/intents/260927-installed/audit/events.jsonl` に `session.started` / `harness:claude` / `actor:hook` が1件生じました。記録時刻は `2026-09-27T10:28:38.476Z` です。この観測は生成設定からの実起動確認であり、新しい stdin fixture の採取ではありません。既存の実機 fixture や golden は変更していません。

別の隔離設定で `--settings` を省いた `--init-only` も試しましたが、記録は生じませんでした。未信頼のフォルダーでの設定自動読み込みを保証する結果ではありません。通常のプロジェクト設定と環境変数には [Claude のフォルダー信頼・設定優先順位](https://code.claude.com/docs/en/settings) が適用されます。実機で確認済みの起動方法は上の明示指定です。

## Linux での検証

既存の Docker イメージ `mcr.microsoft.com/playwright:v1.56.0-noble` の Node.js 22.20.0 を使いました。ホストのソースは読み取り専用でマウントし、テスト対象と必要な開発依存をコンテナ内へコピーして実行しています。測定対象の監査ログは Linux の一時ディレクトリに置き、ネットワークを無効にしました。新しいイメージやパッケージの取得は行っていません。

| 検査 | 結果 |
| --- | --- |
| フック13件、20回の子プロセスを含む | 全件成功 |
| 記録 p95 / 性能テスト所要時間 | 132.9ms / 2.44秒 |
| 配布・配布先シナリオ | 4件成功 |
| lib | 38件成功 |
| lib 行 / 分岐 / 関数カバレッジ | 99.81 / 98.49 / 100% |
| 配布生成と `--check` | 成功、33ファイル |

初回の Linux フック測定も13件成功で p95 は127.0msでした。200ms未満という結果はこのコンテナ環境のもので、Windows の未達を解消したことにはしません。Linux の Lint・型検査・全体 `check`、Node.js 24、リモート CI は今回未実行です。

## Windows の起動・I/O 切り分け

Node.js 24.13.0 で各5回測った補助測定では、空の Node 起動は100.2〜108.7ms、製品フックの no-op は142.8〜164.0ms、記録は168.3〜200.9msでした。別のプロファイル実行5回で、lstat の合計は4.37〜5.21ms、readFile の合計は3.48〜3.95ms、sync は2.38〜5.36msでした。各測定は synthetic 入力を使い、プロファイルはテスト用プリロードだけで行いました。

これは遅延箇所を絞るための小標本で、20回の p95 検査の代用ではありません。前回より起動時間自体が短い観測もあり、Windows の変動要因までは特定できていません。起動コストの差し引きやファイル同期・境界検査の省略は行っていません。

## Windows の最終検証と次の作業

| 検査 | Node.js 22.19.0 | Node.js 24.13.0 |
| --- | --- | --- |
| Lint・型検査 | 成功 | 成功 |
| content / registry / packaging / scenario / unit | 11 / 30 / 3 / 1 / 38件成功 | 11 / 30 / 3 / 1 / 38件成功 |
| hooks | 12件成功、性能1件失敗 | 12件成功、性能1件失敗 |
| 記録 p95 / 性能テスト所要時間 | 234.2ms / 4.26秒 | 235.1ms / 4.14秒 |
| lib 行 / 分岐 / 関数カバレッジ | 99.81 / 98.49 / 100% | 99.81 / 98.49 / 100% |
| 製品フック行 / 分岐 / 関数カバレッジ | 100 / 100 / 100% | 100 / 100 / 100% |

両方とも96件中95件が成功し、`check` は終了1です。今回の最終測定では1件5秒以内に収まりましたが、200ms予算は未達です。途中の Node.js 24 の測定も p95 212.0msで未達でした。配布の生成と `--check` は別途実行して成功しました。

実装した検査は `enforcement-map.json` に追記し、未充足の検査は pending のまま保持しています。元仕様、移行元資料、実機 fixture、golden に変更はありません。実行時依存ゼロも維持しています。

次は Codex の版付き実機 fixture と登録を整えます。Claude UserPromptSubmit を使う emitter は、同文の別操作と再送を区別する ID 契約を先に確定してから実装します。Windows の性能、残り26イベント、doctor、Skill・エージェント・テンプレート、TOML 変換、ワークフロー全体のシナリオ、ミューテーション検証は残件です。
