# 人の承認の真正性と approved 更新・Build 開始の境界

## 範囲と根拠

[Issue #5](https://github.com/otomatty/vouch-workflows/issues/5) の契約と検証記録です。決定記録 §4 の禁止リストと不変条件（人の承認なしに approved にならない、承認済みの計画なしに実装しない）、§5・§6 の確認点と Intent 承認、§11 のフックの責務（承認の真正性：status: approved への変更を、人の決定が監査ログにある時だけ通す）、§18 Q2 の確認点の粒度に従います。§18 の決定と Q1〜Q6 は変えません。

既存の[承認証跡の照合](approval-evidence.md)、[レビュー記録フック](intent-review.md)、[書き込み保護](write-guard.md)を前提にします。今回追加するのは次の4つです。

- 人の入力と、モデルの出力・合成・移行・再送の区別の契約
- 確認点の明示操作と、対象の内容に結び付けた checkpoint.confirmed の記録
- 承認記録と確認点がそろった時に、フックが同じ版の intent.md を draft から approved へ更新する経路
- 設定した Intent が証跡付きの approved でない間、ファイル編集ツールによる実装の書き込みを遮る Build 開始の境界

フックは判断しません。人の明示入力の文字列、成果物のバイト、監査レコードの項目を機械的に照合し、条件を満たした時だけ記録・更新し、満たさない時は理由を返します。計画が妥当か、確認点で何を確認すべきかは人とモデルが決めます。

## 入力の出所と扱い

承認と確認点の証跡になるのは、登録した UserPromptSubmit フックが受け取った人の明示入力だけです。

| 出所 | 例 | 扱い |
| --- | --- | --- |
| 人の明示入力 | 配布の登録で起動したフックが受けた UserPromptSubmit。ハーネスの入力 ID（Claude は prompt_id、Codex は turn_id）を持ち、プロンプトの全文が明示コマンドに完全一致する | 唯一の証跡の入口。gate.opened / checkpoint.confirmed / intent.approved を記録する |
| ハーネスの中継 | Claude の task-notification など、サブエージェントの出力を本文に含む UserPromptSubmit | 全文が完全一致しないので副作用はない。本文にコマンドが含まれても承認・確認にしない |
| モデルの出力 | ツール入力（Write / Edit / Bash / apply_patch / Agent）、応答文、サブエージェントの結果、decisions.md や intent.md の記述 | 証跡にしない。ツール入力の actor などの主張も使わない |
| 構造化質問の回答 | AskUserQuestion / request_user_input の PostToolUse | この版では承認・確認点に使わない。選択肢の文面と対象をモデルが決めるため |
| 合成 | synthetic:true のレコードと入力 | 証跡にしない。照合で除外する |
| 移行・旧形式 | revision / submission / content のない承認・ゲート・確認点、legacy.*、gate.approved | 証跡にしない |
| 既定適用・回答 | question.defaulted、question.answered | 承認・確認点・ゲートの回答にしない |
| 再送 | 同じ入力 ID の再実行 | 最初の記録と時刻を保持し、新しい承認・確認を作らない。同じ入力 ID を別の版・ゲート・対象へ付け替える再送は既存記録との競合（AUDIT-CONFLICT）になり、記録しない |

証跡のレコードは、自身の session・harness・intent・入力 ID から導いた ID を持つ必要があります。フックの ID は `newId(session, ["<type>", harness, intent, field, id])` です。承認と確認点の照合では、レコードの ID をこの導出で再計算し、一致しないレコードを証跡から除きます。入力 ID だけを書き換えたレコードや、ID の導出を持たない移行レコードを除くためです。ハッシュと ID は結び付けであり、真正性の証明ではありません。監査ログへのツールからの書き込みは[書き込み保護](write-guard.md)が登録したツールに限って拒否します。

## 明示操作

語彙は `core/registry/intent-review.json` が正典です。プロンプトの全文が完全一致した時だけ扱い、前後の文や改行を許しません。自然文をこの形式へ変換しません。

| 入力 | 記録 | 条件 |
| --- | --- | --- |
| `vouch review` | gate.opened（既存） | 設定した Intent の intent.md が対応する draft |
| `vouch confirm <対象>` | checkpoint.confirmed | 同上。対象が文書に一意に存在する |
| `vouch approve evt_<64桁>` | intent.approved（既存） | 同上。ゲートと照合が一致する（既存） |

`<対象>` は `acceptance`、`scope`、`units`、`design`、`unit <Unit ID>`、`section <節 ID>` のどれかです。Unit ID は `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`、節 ID は `^[a-z][a-z-]{0,63}$` に従います。`vouch confirm` に続く不正な対象は `VOUCH-REVIEW-COMMAND` です。

明示操作の結果は、記録・更新の成功を含めて終了2と stderr の理由で返し、入力をモデルへ進めません。予期しない I/O・競合・実装エラーは HOOK-2 の終了0の診断です。

## 確認点

### 粒度の選択

粒度は `vouch/rules.md` の frontmatter の `checkpoints:`（topic / unit / section）で選びます。ファイルがなければ `workflow.json` の既定 topic です。ファイルがあるのに frontmatter の区切り、`checkpoints:` の1行、選択肢のどれかが欠ける・重複する・不正な場合は設定誤りとし、承認を適用しません。黙って既定に置き換えません。

### 計画の読み取り

必要な確認点を決めるため、intent.md の `<!-- sec:plan -->` 節の最初の Markdown 表を読みます。書式は `core/registry/approval.json` が正典です。

- 1行目は見出し、2行目は区切り行、3行目以降の各行が1つの Unit
- 1列目は Unit ID。重複しない
- 4列目（リスク階層と根拠）は `L`・`M`・`H` の識別子で始まる
- 5列目（Design 要否と理由）は `required` または `not-required` の識別子で始まる
- H の Unit は Design が必要なので、`not-required` は不正

識別子は英語固定です（§18 Q6）。テンプレートの記入欄（未評価、未確定など）が残る計画は不正で、承認を適用しません。Intent のリスク階層は Unit の最高位、Design の要否は H の Unit があるか `required` の Unit があるかで決めます。計画の良し悪しは判定しません。

### 必要な確認点

| 粒度 | 必要な確認点 |
| --- | --- |
| topic（既定） | acceptance、scope、units。Design が必要なら design |
| unit | acceptance と各 Unit。Design が必要なら design |
| section | intent-authoring.json の intent_sections の各節。Design が必要なら design |

どの粒度でも、Intent が H なら各 Unit の確認を加えます（`workflow.json` の high_risk_adds）。§18 Q2 の既定 A（論点ごとの固定4点、Design 不要なら3点、H は Unit ごとを追加）です。unit / section の design は design.md の節の契約がまだないため（#9）、design.md 全体への1回の確認とします。rules.md に書く範囲の説明は人のための記述で、フックは読みません。

### 確認の対象と版

確認は、人が確認した時点の対象の内容に結び付けます。checkpoint.confirmed の `content` は、対象の内容の SHA-256 です。

| 対象 | 内容 |
| --- | --- |
| acceptance / scope / units | intent.md の `sec:acceptance` / `sec:scope` / `sec:plan` 節 |
| section `<ID>` | intent.md の `sec:<ID>` 節 |
| unit `<ID>` | `sec:plan` 節の最初の表で、1列目が ID の行 |
| design | design.md 全体。intent.md と同じ frontmatter の規則で status を draft に置き換えた版 |

節は `<!-- sec:ID -->` だけの行から、次の `<!-- sec:` で始まる行の前まで（なければ末尾まで）のバイト列です。区切り行と改行を含み、正規化しません。区切り行が1つでない、行がない、design.md が対応する frontmatter を持たない場合は対象がなく、`VOUCH-CHECKPOINT-TARGET` で記録しません。

承認を適用する時、必要な確認点ごとに、現在の内容と同じ `content` を持つ確認が監査にある必要があります。確認の後で対象が変わると、その確認点だけが古くなり、人が確認し直します。確認していない節の変更は他の確認を古くしません。§6 の「差分だけ確認する」に対応します。

確認として数えるのは、次をすべて満たす checkpoint.confirmed だけです。synthetic でない、設定した Intent、`content`・`submission`・`session`・`harness` を持つ、ID が導出と一致する、対象と内容が一致する。question.answered / question.defaulted、gate.approved、intent.approved、decisions.md の記述、ファイルの存在、無回答は確認ではありません。

### 監査レコード

checkpoint.confirmed に任意の `content`（path は intent.md か design.md、design の確認は design.md）と `submission` を加えます。`content` を持つレコードは `harness`・`session`・`submission` を要求し、`submission.field` は Claude が prompt_id、Codex が turn_id です。旧形式のレコードはスキーマ上有効なまま、証跡には数えません。ts は同じ ID の最初の記録を保持します。

## 承認の適用

### 条件

設定した Intent の intent.md が対応する draft で、版 R について次がすべて成り立つ時、フックは intent.md を approved にします。

1. R の承認がある。intent.approved が synthetic でなく、設定した Intent、revision・submission・session・harness を持ち、revision が R、ID が導出と一致する。親の gate.opened が synthetic でなく、同じ Intent・ハーネス・revision R を持ち、ID が異なり、時刻差が wait_ms と一致する。
2. rules.md の粒度が有効で、計画が読める。
3. 必要な確認点がすべて現在の内容で確認されている。

`vouch approve` は、既存の照合が一致すれば、条件2・3に関わらず承認を記録します（既存の記録の契約）。条件がそろえば同じ入力で適用し、`VOUCH-APPROVAL-APPLIED` を返します。そろわなければ記録だけを行い、`VOUCH-APPROVAL-RECORDED` と適用しなかった理由（rules、plan、checkpoints と不足の一覧）を返します。その後の `vouch confirm` で条件がそろった時は、その確認の記録と同じ入力で適用し、理由に approved を示します。人が承認をやり直す必要はありません。

同じゲートに条件1を満たす承認がすでにある時、別の入力 ID の `vouch approve` は新しい承認を記録せず、既存の承認で適用を判定します。同じ回答の待ち時間を二重に数えないためです。同じ入力 ID の再送は既存の記録と同じ ID になり、追記しません。

### 更新の手順と順序

HookResult の `approve: {sha256}` が、承認の適用の指示です。io.run は、監査レコードの追記に成功した後に、設定した Intent の intent.md を FileStore の updateText（ロック・一時ファイル・原子的な置き換え）で更新します。更新の関数は、その時点の本文が版 sha256 の対応する draft の時だけ、frontmatter の `status: draft` を `status: approved` に置き換えます。本文・改行・末尾は変えないので、版は同じです。すでに同じ版の approved なら書き込みません。それ以外（競合する変更、版の違い、ファイルの消失）は例外とし、HOOK-2 の終了0の診断になります。記録は残り、同じ入力の再送か次の確認で適用できます。

モデルとツールは approved を作りません。書き込み保護はツールからの approved の作成と承認済みの変更を引き続き拒否します。正規の更新主体はこのフックだけです。

## Build 開始の境界

設定した Intent があり、PreToolUse のツールがファイル編集ツール（Claude の Write / Edit、Codex の apply_patch）の時、書き込み保護の検査の後に次を検査します。

- 対象：プロジェクト内で `vouch/` の外にあるパス、または設定した Intent の Build・Verify の成果物（build-log.md、review.md）
- 許可：intent.md が approved で、その版に「承認の適用」の条件1の承認がある
- 拒否：それ以外。`VOUCH-BUILD-UNAPPROVED` と理由（intent.md がない、draft、未対応、その版の承認の証跡がない、読めない）

監査や intent.md を読めない時は、fail-open にせず拒否します。確認点は承認の適用時に検査済みなので、Build 開始では再検査しません。承認後に rules.md の粒度を変えても、承認済みの計画を遡って無効にしないためです。

`vouch/` の中（Intent の下書き、decisions.md、design.md、rules.md、知識レイヤー）と、プロジェクトの外への書き込みは対象外です。Intent を設定していない時は検査しません。シェルのコマンドは、任意のプログラムの書き込み先を機械的に確定できないため対象外です。Skill はファイル編集ツールで実装します。builder エージェント（#8）の起動の検査は、エージェントの定義とともに同じ判定を使って追加します。

## 承認コミットと PR

承認コミットは、フックが approved にした intent.md と decisions.md を、モデルが git で commit するものです。ツールから approved を作れないため、登録したツールの範囲では commit される approved は正規の経路のものに限られます。commit・push の内容の直接の検査は Git 操作のガード（#6）で扱います。

Intent の承認は PR の承認ではありません。このフックは gate.approved（source: pr）を記録せず、PR のマージを行いません。L を含むすべてのリスク階層で、確認点と承認は同じ条件です。PR は人が Brief を読んでマージし、`workflow.json` の auto_merge は false のままです。モデルによるマージの遮断は #6 の範囲です。

## 理由 ID

| 理由 ID | 条件 |
| --- | --- |
| `VOUCH-CHECKPOINT-RECORDED` | 確認点を記録した。承認を適用した時はそれも示す |
| `VOUCH-CHECKPOINT-TARGET` | 確認の対象が文書にない、または一意でない |
| `VOUCH-APPROVAL-RECORDED` | 承認を記録したが、適用の条件がそろわない |
| `VOUCH-APPROVAL-APPLIED` | 承認を記録し、intent.md を approved にした |
| `VOUCH-BUILD-UNAPPROVED` | 証跡付きの承認済み計画なしに実装を書き込む |

既存の `VOUCH-REVIEW-COMMAND`・`-IDENTITY`・`-DRAFT`・`-EVIDENCE`・`-RECORDED` は変えません。

## 検証の方法

契約・型、失敗する先行テスト、実装の順にコミットします。既存の fixture、golden、元仕様、移行元資料を合格のために変更しません。

- unit：計画・粒度・対象の内容・必要な確認点・確認の数え方、承認の連鎖と適用の関数、Build の判定、io の適用の順序と競合、監査の一覧を直接検査します。
- hooks：Claude 2.1.283 / Codex 0.153.4 の版付き UserPromptSubmit と Write / Edit / apply_patch の採取から派生した synthetic 入力を runHook で実行します。正例に加え、偽装（actor の主張、ID の導出の不一致、synthetic、task-notification の本文、構造化質問の回答、question.defaulted、gate.approved）、欠損（ゲート・確認・計画・rules・design.md）、破損（監査・rules・frontmatter）、再送（同じ入力、付け替え、適用後）を検査します。既存の記録だけのテストは記録の契約として残し、承認の適用と Build の境界は別のテストで検証します。
- registry：スキーマの受理・拒否と Ajv の一致、語彙と計画の書式の整合を検査します。
- 実機：配布をコピーした隔離プロジェクトで、ネイティブ CLI にスクリプトの入力を送り、確認・承認の適用と Build の境界を観測します。スクリプト入力の観測であり、人の承認やモデル評価ではありません。

## 検出・拒否できる範囲と限界

| 経路 | 扱い |
| --- | --- |
| 登録したツールでの approved の作成・承認済みの変更 | 書き込み保護が拒否（既存） |
| 確認点の不足・古い確認での承認 | 記録だけにして適用しない |
| 古い承認・別 Intent・合成・旧形式・ID の導出の不一致 | 承認の連鎖に数えない |
| 承認なしのファイル編集ツールによる実装の書き込み | Build の境界が拒否 |
| シェルでの実装の書き込み、登録していないツール、サブエージェントの未採取の経路 | 検査外 |
| 任意のプロセスからの stdin の偽装、ハーネス外での監査・成果物の編集 | 検査外。形式と ID の導出が正しい偽のレコードは区別できない |
| 検査とツール実行の間の競合 | 防がない |
| Intent を設定していないセッション | 検査しない |
