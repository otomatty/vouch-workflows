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
- 同じハーネス・イベント・ツールの実機 fixture から派生し、同じ版と、その fixture と同じ採取元（source）を持つ `synthetic: true` の入力

派生では payload を変更し、実機の版と採取元を残します。一覧に実機 fixture がない種別と、版が不明な既存 Codex 9件は、契約実行で拒否します。`version: null` を、採取日・model・別記録から埋めることはしません。

判定は `tests/helpers/fixtures.mjs` の `contractReference()` で行い、`runHook()` はその結果に従います。以前は SessionStart と UserPromptSubmit だけに固定した分岐でした。その範囲の動作は変えません。

## 終了コードの伝播

生成した `dist/<harness>` を変更せずに隔離プロジェクトへコピーし、登録済みのフックだけで次のケースを実行します。呼び出し元の `VOUCH_HARNESS` はもう一方のハーネス名にし、登録が上書きすることを記録の harness で確かめます。

| ケース | 入力と状態 | 期待する観測 |
| --- | --- | --- |
| allow | 通常のプロンプト | session.started のみ記録。プロンプトがプロバイダーに届く。非対話 CLI は終了0 |
| open | `vouch review` と下書き | session.started と gate.opened。プロンプトは届かず、理由 `VOUCH-REVIEW-RECORDED` が CLI 出力に出る |
| invalid | `vouch approve` と不正な ID | session.started のみ。プロンプトは届かず、理由 `VOUCH-REVIEW-COMMAND` が出る |
| corrupt | 破損した監査ログと `vouch review` | 監査ログのバイトは不変。フックは fail-open の終了0で、プロンプトが届く。非対話 CLI は終了0 |
| no-intent | Intent 未指定で `vouch review` | 監査ログを作らない。プロンプトが届く。非対話 CLI は終了0 |

終了2は、プロンプトがプロバイダーに届かないこと、および理由の表示で確認します。終了0は、プロンプトが届くことで確認します。プロバイダーへの要求のうち、プロンプト本文を含む会話要求だけを数えます。接続確認と、Codex の system スレッドによるタイトル生成は数えません。対話 CLI は観測後に検証側が終了させるため、CLI の終了コードでは判定しません。

Codex の `VOUCH_PROJECT_ROOT` を外したケースは、登録コマンドのシェルが失敗した時の観測として記録します。期待値は置かず、合否に含めません。

検証コマンドは `scripts/check-hook-propagation.mjs` です。開発時の手動実行用で、通常の check と配布物には含めません。結果を検証する純粋関数は `scripts/lib/propagation.mjs` に置き、保存した観測を packaging テストで照合します。Windows では起動を拒否し、確認済みとは扱いません。

```sh
node scripts/package.mjs
node scripts/check-hook-propagation.mjs claude /absolute/path/to/claude noninteractive
node scripts/check-hook-propagation.mjs codex /absolute/path/to/codex interactive
```

## 区別するもの

版付き実機 fixture、手製の synthetic 入力、固定応答による CLI 実行、実モデルの評価、人の実承認を区別します。伝播の検証で記録された gate.opened は、スクリプト入力の記録です。人の同意の証明にはしません。確認した OS・版・対話 / 非対話の範囲は、実行結果とともに記録します。未確認の組み合わせを確認済みとは扱いません。

## 採取結果

2026-09-28、採取時 HEAD `8c975f3` で、Linux の CLI から採取しました。手順と観測の詳細は [Linux の実機採取](../../tests/fixtures/captures/linux/README.md) にあります。Claude の起動では、架空のモデル名 `vouch-capture-model` を指定しました。CLI 既定のモデル識別子を payload に残さないためです。必要な28種のすべてに、版付き実機 fixture があります。

| ハーネス | 版・OS・経路 | 採取した種別 |
| --- | --- | --- |
| Claude Code | 2.1.280 Windows 非対話（既存） | SessionStart、UserPromptSubmit、Write の PreToolUse / PostToolUse |
| Claude Code | 2.1.283 Linux 非対話 | SessionStart（startup / resume / compact）、UserPromptSubmit、PreCompact、Write・Edit・Bash・Agent の PreToolUse / PostToolUse、SubagentStop、Stop |
| Claude Code | 2.1.283 Linux 対話 | SessionStart、UserPromptSubmit、AskUserQuestion の PreToolUse / PostToolUse |
| Codex | 0.153.4 Windows 対話（既存） | SessionStart、UserPromptSubmit |
| Codex | 0.153.4 Linux 非対話 | SessionStart（startup / resume）、UserPromptSubmit、apply_patch・Bash・collaborationspawn_agent の PreToolUse / PostToolUse、request_user_input の PreToolUse、SubagentStop、Stop |
| Codex | 0.153.4 Linux 対話 | PreCompact、Plan モードでの request_user_input の PreToolUse / PostToolUse |

採取中の拒否と payload の制約は、inventory.json の constraints に記録しました。主なものは次のとおりです。

- Codex の request_user_input は、Default モードでは PreToolUse の後に拒否され、PostToolUse が出ない。
- Codex の失敗したコマンドの PostToolUse には、終了コードが含まれない。Claude の失敗したコマンドは PostToolUseFailure で届く。
- Claude の Agent は非同期に起動し、完了は task-notification の UserPromptSubmit でも届く。
- Claude の `/compact` が生む SubagentStop は `agent_type` が空文字で、hook-input スキーマに合わない。
- Windows の Codex では、ツール系の採取が以前の試行でポリシーにより拒否された。

hook-input の契約外のイベント（SessionEnd、SubagentStart、PostToolUseFailure、PostCompact）は、原文にだけ残しました。スキーマは変更していません。拒否された操作の payload を手で作ったり、`version: null` を埋めたりもしていません。

## 伝播の検証結果

2026-09-28、コミット `43c45ed` の検証コマンドを、Linux と Node.js v22.22.2 で実行しました。観測は `tests/fixtures/native/hook-propagation-linux.json` に保存しています。

| ハーネス | 版 | 経路 | 結果 |
| --- | --- | --- | --- |
| Claude Code | 2.1.283 | 非対話 `--print` | 5ケースとも期待どおり |
| Claude Code | 2.1.283 | 対話 CLI（疑似端末） | 5ケースとも期待どおり |
| Codex | 0.153.4 | 非対話 `exec` | 遮断・許可・fail-open は期待どおり。open / invalid で理由が表示されず、検証コマンドは FAIL |
| Codex | 0.153.4 | 対話 CLI（疑似端末） | 5ケースとも期待どおり。no-root は記録のみ |

- 終了2：遮断した回には、両ハーネスともプロンプトを含む要求が0件だった。
  - Claude は「UserPromptSubmit operation blocked by hook」に続けて、フックの理由を表示した。`--print` の終了コードは0。
  - Codex の対話 CLI は「Blocked by hook」と理由を表示した。
  - Codex exec は「hook: UserPromptSubmit Blocked」だけを表示した。理由は `--json` の出力にも含まれず、終了コードは0。
- 終了0：allow・corrupt・no-intent では、プロンプトがプロバイダーに届いた。corrupt では監査ログのバイトが変わらず、no-intent では監査ログが作られなかった。非対話 CLI の終了コードは0。Claude の対話 CLI では、プロンプトを含む要求が1回の入力につき2件あった。判定は1件以上かどうかだけで行う。
- 記録の harness：呼び出し元の `VOUCH_HARNESS` をもう一方の名前にしても、両ハーネスとも自分の名前で記録された。
- Codex の no-root：登録コマンドのシェルが失敗し、対話 CLI は「hook exited with code 127」、exec は「Failed」と表示した。Codex はこれを遮断として扱わず、プロンプトはプロバイダーに届いた。監査ログは作られなかった。

Codex exec で理由が表示されないことは、フックではなく CLI の表示の問題です。フックの stderr は他の経路で表示されています。期待値は変えず、この2件を packaging テストで既知の不一致として固定しました。将来の版で表示が変われば、テストが差分を示します。

## 確認範囲と残る検証

| OS | ハーネス・版 | 非対話 | 対話 |
| --- | --- | --- | --- |
| Linux | Claude Code 2.1.283 | 採取・伝播とも確認 | 採取・伝播とも確認 |
| Linux | Codex 0.153.4 | 採取・伝播とも確認。遮断理由は表示されない | 採取・伝播とも確認 |
| Windows | Claude Code 2.1.280 | 一部の採取と、SessionStart 登録の実起動 | 未確認 |
| Windows | Codex 0.153.4 | 採取できず（既存記録） | 一部の採取と、レビュー記録の実起動（[実機検証](codex-review-smoke.md)） |
| macOS | 両ハーネス | 未確認 | 未確認 |

次の項目は未確認・未実装のままです。

- Windows と macOS でのツール系・残り種別の採取と伝播の検証。検証コマンドは Windows に対応していない。
- 他の CLI の版。Claude の自動圧縮（trigger: auto）、Codex の SessionStart compact などの変種。
- compact 由来の SubagentStop の空 `agent_type` の扱い。agent-record フックの契約で決める。
- 保護・記録フックの本体。この Issue では入力の根拠と伝播の確認を揃えただけで、フックの動作は実装していない。
