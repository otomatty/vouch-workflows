# 版付きハーネス fixture と終了コード伝播の検証

## 契約

TEST-7 の対象を、後続の保護・記録フックが読むイベントと対応ツールに広げます。一覧は `tests/fixtures/harness/inventory.json` に置き、構造を `tests/fixtures/harness/inventory.schema.json` で固定します。配布物には含めません。一覧は決定記録 §11 のフックの責務、§10 の構造化質問、§15 の登録イベントを根拠にします。

| 用途 | イベントとツール | 根拠 |
| --- | --- | --- |
| session-record | SessionStart（startup / resume / compact）、PreCompact | §11 セッション開始・再開、監査台帳の session.* |
| review-record | UserPromptSubmit | 実装済みのレビュー記録フック |
| artifact-guard | PreToolUse：Claude の Write / Edit / Bash、Codex の apply_patch / Bash | §11 承認の真正性、禁止リストの機械的部分 |
| command-guard | PreToolUse：両ハーネスの Bash | §11 契約 → テスト → 実装の順序、main への push |
| artifact-check | PostToolUse：Claude の Write / Edit、Codex の apply_patch | §11 引用検査、判断依頼の形式検査 |
| command-record | PostToolUse：両ハーネスの Bash | §11 DoD の実行と記録 |
| question-record | PreToolUse / PostToolUse：Claude の AskUserQuestion、Codex の request_user_input | §10 構造化質問 |
| agent-record | PreToolUse / PostToolUse：Claude の Agent、Codex の spawn_agent と SubagentStop | 監査台帳の `review.*` / `aside.*` |
| turn-end | Stop | §15 のフック登録 |

一覧の単位はハーネス・イベント・ツールです。ツール名は CLI が stdin に書いた値をそのまま使います。どの項目にも、版付きの実機 fixture か、採取できない理由の記録が必要です。source・trigger の値はイベント内の変種として扱い、採取した値を資料に記録します。

## 実機 fixture の条件

実機 fixture は、インストール済み CLI が記録用フックの stdin に書いた JSON 1行です。採取原文を `tests/fixtures/captures/` にバイトのまま保存し、包装の payload は原文の該当行と同値にします。包装には harness、実行版、採取時の HEAD、原文のパスと行の key を記録します。原文ごとの OS、対話 / 非対話、起動方法、採取日、採取スクリプトは一覧の captures に記録します。

key は `<イベント>[.<ツール>][#<n>]` です。原文の中で同じイベント・ツールの行を先頭から数え、n 番目を指します。`#<n>` を省いた既存の key は1番目を指します。

採取では、隔離した設定領域・プロジェクトと、固定応答を返すループバックのプロバイダーを使います。応答中のツール要求は手製です。一方、保存する stdin は CLI 自身が生成した値です。固定応答の内容を fixture へ転記しません。モデル評価や人の承認の実績にも数えません。

信頼の登録は、`hooks/list` が返す正確な定義ハッシュに限ります。Codex の信頼チェックやサンドボックスを迂回するオプションは使いません。採取中にポリシーや権限で拒否された操作は、一覧の constraints に記録します。拒否された操作の payload を手で作ることはしません。

## 契約実行の適格性

契約テストに使えるのは、次の二つだけです。

- 一覧に載った実機 fixture そのもの
- 同じハーネス・イベント・ツールの実機 fixture から派生し、同じ版を持つ `synthetic: true` の入力

派生では payload を変更し、実機の版と採取元を残します。一覧に実機 fixture がない種別と、版が不明な既存 Codex 9件は、契約実行で拒否します。`version: null` を、採取日・model・別記録から埋めることはしません。

判定は `tests/helpers/fixtures.mjs` の純粋関数で行い、`runHook()` はその結果に従います。以前は SessionStart と UserPromptSubmit だけに固定した分岐でした。その範囲の動作は変えません。

## 終了コードの伝播

生成した `dist/<harness>` を変更せずに隔離プロジェクトへコピーし、登録済みのフックだけで次のケースを実行します。呼び出し元の `VOUCH_HARNESS` はもう一方のハーネス名にし、登録が上書きすることを記録の harness で確かめます。

| ケース | 入力と状態 | 期待する観測 |
| --- | --- | --- |
| allow | 通常のプロンプト | session.started のみ記録。プロンプトがプロバイダーに届く。非対話 CLI は終了0 |
| open | `vouch review` と下書き | session.started と gate.opened。プロンプトは届かず、理由 `VOUCH-REVIEW-RECORDED` が CLI 出力に出る |
| invalid | `vouch approve` と不正な ID | session.started のみ。プロンプトは届かず、理由 `VOUCH-REVIEW-COMMAND` が出る |
| corrupt | 破損した監査ログと `vouch review` | 監査ログのバイトは不変。フックは fail-open の終了0で、プロンプトが届く。非対話 CLI は終了0 |
| no-intent | Intent 未指定で `vouch review` | 監査ディレクトリを作らない。プロンプトが届く。非対話 CLI は終了0 |

終了2は、プロンプトがプロバイダーに届かないこと、および理由の表示で確認します。終了0は、プロンプトが届くことで確認します。プロバイダーへの要求のうち、プロンプト本文を含む会話要求だけを数えます。接続確認と、Codex の system スレッドによるタイトル生成は数えません。対話 CLI は観測後に検証側が終了させるため、CLI の終了コードでは判定しません。

Codex の `VOUCH_PROJECT_ROOT` を外したケースは、登録コマンドのシェルが失敗した時の観測として記録します。期待値は置かず、合否に含めません。

検証コマンドは `scripts/check-hook-propagation.mjs` です。開発時の手動実行用で、通常の check と配布物には含めません。結果を検証する純粋関数は `scripts/lib/propagation.mjs` に置き、保存した観測を packaging テストで照合します。POSIX 以外、特に Windows の対話端末は対象外として扱います。

## 区別するもの

版付き実機 fixture、手製の synthetic 入力、固定応答による CLI 実行、実モデルの評価、人の実承認を区別します。伝播の検証で記録された gate.opened は、スクリプト入力の記録です。人の同意の証明にはしません。確認した OS・版・対話 / 非対話の範囲は、実行結果とともに記録します。未確認の組み合わせを確認済みとは扱いません。
