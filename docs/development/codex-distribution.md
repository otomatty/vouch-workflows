# Codex の SessionStart 登録と配布

## 契約

Codex 0.153.4 の対話 CLI で採取した SessionStart / startup を、Claude と同じ製品フックで記録します。入力と出力の既存スキーマは変更せず、JSDoc の Harness と共通 runtime の検証済み context を使います。出力の harness と ID はインストール側の `VOUCH_HARNESS` に従い、stdin の名乗りや model から推測しません。tokens・duration は未取得なら省略します。

明示された絶対パス `VOUCH_PROJECT_ROOT` と `VOUCH_INTENT` を使い、同一 Intent・session・harness の再送では最初の timestamp を保持します。別ハーネスの同じ session は別 ID です。startup 以外、Intent 未指定は副作用なしです。空 stdout・終了0、エラー時の fail-open、監査ファイルの境界検査は既存契約を維持します。

`harness/codex/manifest.mjs` から `.codex/hooks/`、`.codex/registry/`、`.codex/hooks.json`、`.codex/config.toml` をバイトコピーします。登録は SessionStart / startup の1本です。POSIX 用 command と Windows PowerShell 用 commandWindows が `VOUCH_HARNESS=codex` を設定し、引用符付きの明示 root からスクリプトを起動します。サブディレクトリから起動しても stdin の cwd を配布先の推測に使いません。

config.toml は hooks の有効化、workspace-write サンドボックス、agents.max_depth=1 だけを持ちます。決定記録 §18 Q5 に従いサンドボックス設定を配布に含めます。プロバイダー、モデル、個人の信頼状態、承認バイパスは配布しません。既存設定への自動マージは今回の対象外です。

[Codex のフック文書](https://learn.chatgpt.com/docs/hooks)に従い、プロジェクトとフック定義の信頼は利用者が確認します。設定を検出できただけでは実行成功と扱いません。Windows の確認対象は PowerShell、POSIX は sh 系のコマンド実行です。ほかの Windows シェルは未検証です。

## テストを先に固定する項目

- 採取原文と包装 payload の一致、版と採取元 HEAD、既存の版不明9件の不変性。
- Codex startup の完全な監査 golden、再送、ハーネスごとの ID、偽の stdin harness、非 startup の no-op。
- 改変された入力の synthetic 表示と版の一致。イベントごとの実機根拠がない入力は製品テストの正例にしない。
- 両プラットフォームの登録と製品フックの双方向一致、配布のファイル集合・バイト一致、不要物の不在。
- 空白・日本語・ドル記号・アポストロフィを含むインストール先のサブディレクトリから、生成コマンドをシェルで実行して golden と再送を検査する。

追加する golden は Codex の session ID と harness を固定する別ファイルです。既存 Claude golden を更新しません。テストで cwd 等を変更した payload は synthetic とし、シェル経由の実行を Codex 実機確認とは区別します。

## 実機採取

2026-09-27、採取時 HEAD `99230c6`、Windows の `codex-cli 0.153.4` を使用しました。原文は `tests/fixtures/captures/codex-0.153.4.jsonl`、包装は `tests/fixtures/harness/codex/0.153.4/` に保存します。既存の移行元資料と版不明 fixture は変更しません。

CODEX_HOME と Git プロジェクトを reports/codex-legacy 以下へ隔離し、既存の record.mjs を user hooks.json に登録しました。隔離設定の hooks.state へ実際の hooks/list の currentHash を登録し、隔離プロジェクトを trusted として、対話 CLI を `--no-alt-screen -C <project> 'Capture hook stdin only.'` で起動しました。SessionStart と UserPromptSubmit が各1行記録されました。

プロバイダーは接続不能な `http://127.0.0.1:1/v1`、plugins / remote_plugin は無効です。記録用フックは UserPromptSubmit で終了2を返しますが、今回のシェル経路ではその後にループバックへの再接続表示が出ました。採取成功を「終了2でモデル処理を阻止した」証拠にはしません。外部のモデル応答は得ていません。

非対話 exec と app-server でも隔離環境で試しましたが、採取を確認できませんでした。0.158.0-alpha.2.1 の非対話起動でも同じです。これらの経路・版を対応済みとは扱いません。最初の試行ではプラグインカタログ取得が走ったため、後続試行で無効化しました。実ユーザーの Codex 設定は変更していません。

## 残る検証

製品の実登録、Node.js 22 / 24 の check、Linux のシェル配布テストを実装後に検証します。Windows の既知の p95 未達はこの拡張では解決済みにしません。UserPromptSubmit の記録は将来の契約根拠であり、emitter は今回実装しません。残り26イベント、doctor、Skill・エージェント、TOML 変換、移行、ワークフロー全体のシナリオ、ミューテーションは後続です。

## 実装と実機インストール確認

契約と原文保存は `fe8ce31`、実装前のテストは `4f4b5a5` です。製品と配布がないことによる4件の失敗を確認してから実装しました。製品フックの Claude 限定条件を外し、ハーネスごとの処理分岐を追加せず、共通の検証済み context で記録します。ランタイムの依存は引き続き Node.js 組み込みだけです。

`node scripts/package.mjs` は Claude 33ファイルと Codex 34ファイル、計67ファイルを生成します。package.mjs の内容分岐や行数は増やしていません。配布先は `dist/codex/` です。空のプロジェクトへその内容をコピーすると `.codex/` が配置されます。既存の `.codex/` へ丸ごと上書きするインストーラーではありません。

起動するシェルで root と Intent を明示します。プロジェクトとフック定義を確認して信頼した後、対話 Codex を起動します。`VOUCH_HARNESS` は登録コマンドが設定します。

```powershell
$env:VOUCH_PROJECT_ROOT = (Get-Location).Path
$env:VOUCH_INTENT = '260927-orders'
codex
```

```sh
export VOUCH_PROJECT_ROOT="$PWD"
export VOUCH_INTENT=260927-orders
codex
```

2026-09-27、生成配布を `reports/codex-installed/project space/` へコピーし、独立した CODEX_HOME を用意しました。プロジェクトの config.toml と hooks.json のバイトは変更していません。`hooks/list` で project の SessionStart を検出し、その正確な currentHash だけを隔離した user config の hooks.state に設定しました。信頼チェックのバイパスオプションは使っていません。

`VOUCH_PROJECT_ROOT` と `VOUCH_INTENT=260927-installed` に加え、呼び出し元の `VOUCH_HARNESS=claude` を意図的に設定して、次の形式で対話 CLI を起動しました。

```powershell
codex --no-alt-screen -a never -s read-only -C '<project>' 'Verify installed startup hook only.'
```

project の SessionStart 登録から、時刻 `2026-09-27T11:14:07.113Z`、session `01a0e292-77ec-7a23-bbce-b2f701b972da` の `session.started / actor:hook / harness:codex` が1件生じました。保存先は指定した Intent の監査 JSONL です。これは製品の実登録確認で、SessionStart stdin の再採取ではありません。今回の実機確認は CLI 引数で read-only に上書きしているため、配布の workspace-write 動作全体を検証した結果とはしません。

別の user UserPromptSubmit フックを採取用に追加し、PowerShell の末尾で `exit $LASTEXITCODE` を明示しました。CLI に「Blocked by hook」と採取用の理由が表示され、モデル処理を停止しました。プロバイダーは引き続きループバック、プラグインは無効です。この採取用登録・プロバイダー設定・信頼状態は配布に含めません。

## 検証結果と残件

| 検査 | Windows Node.js 22.19.0 | Windows Node.js 24.13.0 |
| --- | --- | --- |
| Lint・型検査 | 成功 | 成功 |
| content / registry / packaging / scenario / unit | 11 / 32 / 4 / 2 / 38件成功 | 11 / 32 / 4 / 2 / 38件成功 |
| hooks | 16件成功、性能1件失敗 | 16件成功、性能1件失敗 |
| 記録 p95 / 性能ケース所要時間 | 230.0ms / 4.35秒 | 225.7ms / 4.31秒 |
| lib 行 / 分岐 / 関数カバレッジ | 99.81 / 98.49 / 100% | 99.81 / 98.49 / 100% |
| 製品フック行 / 分岐 / 関数カバレッジ | 100 / 100 / 100% | 100 / 100 / 100% |

両方とも104件中103件が成功し、check は終了1です。最終の Node.js 22 では全ケースが実行され、キャンセルはありません。途中では packaging/check.test.mjs 内の2件の合計が Node.js 22 のファイル単位5秒制限に当たったため、リンク検査を独立ファイルに移しました。検査内容、アサーション数、時間制限は維持しています。型検査で指摘されたテスト入力の union 型の扱いも修正しました。

既存の `mcr.microsoft.com/playwright:v1.56.0-noble` を使い、Linux / Node.js 22.20.0 でも実行しました。ソースを読み取り専用でマウントし、コンテナ内へコピーして、ネットワークなしで検査しています。配布・配布先シナリオ6件は成功し、POSIX コマンドでもサブディレクトリから記録と再送を確認しました。hooks は16件成功、性能1件失敗で、p95 228.1ms、性能ケース2.85秒、製品フックのカバレッジは100 / 100 / 100%でした。

この Linux 結果は、Claude 配布時の p95 132.9ms とは別の実行結果です。今回は Windows と Linux の両方で200ms未満を確認できていません。再試行で成功した測定だけを選ぶこと、スキップ、閾値緩和、プロセス起動時間の差し引きはしていません。Linux の全体 check、Node.js 24、Codex CLI 自体は今回未検証です。

元仕様・移行元資料・旧 Codex fixture・既存 Claude golden に差分はありません。新規 golden は Codex の session と harness、初回時刻保持を固定する目的で `UPDATE_GOLDEN=1` を明示して生成しました。検査対応表には実装済みの範囲を追加し、他イベント・実機異常系・全体配布などの pending は残しています。

次は記録フックの性能変動を切り分け、起動・検証・I/O のどこで予算を超えるか確認します。その後、doctor の配布・設定検査を整備します。非対話 Codex、他の版・Windows シェル、残り26イベント、Skill・エージェント・テンプレート、TOML 変換、移行、ワークフロー全体のシナリオ、ミューテーションは未完了です。
