# Design・Build・Verify の Skill と日英成果物

## 範囲と根拠

[Issue #9](https://github.com/otomatty/vouch-workflows/issues/9) の契約と検証記録です。決定記録 §5（4ステージと儀式）、§6（人のレビューの場面と分割）、§7（品質モデルと証拠の書式）、§8（検証の優先順位）、§9（独立検証・リスク階層・破壊検査）、§10（判断依頼）、§11（Git・監査・フックの境界）、§13（根本解決と最小実装）、§14（Review Brief と図解）、§15（配布物）と、優先する §18（Q1〜Q6 の決着）に従います。Q1〜Q6 を未決事項として扱いません。実装ルールは STR-3、STR-5、DOC-1〜DOC-4、DOC-6〜DOC-8、DIST-1、DIST-2 です。

既存の [Intent 下書き](intent.md)、[承認の境界](approval-boundary.md)、[Git 操作の検査と DoD](git-guard.md)、[知識レイヤー](knowledge.md)、[エージェント](agents.md)を前提にします。今回追加するのは次の3つです。

- `vouch-design`・`vouch-build`・`vouch-verify` の3つのステージ Skill（`core/skills/vouch-<stage>/SKILL.md`）
- design.md・build-log.md・review.md（Review Brief）の日英テンプレート（`core/templates/{ja,en}/`）
- 上の節 ID・Brief の対応・証拠の書式・読むべき箇所の分類・往復の上限・Skill が指示できる Git のサブコマンドを持つ正典 `core/registry/stage-authoring.json` とそのスキーマ

実行時 JavaScript（フック・lib）は追加・変更しません。Skill は判断を担うモデルへの指示で、記録・遮断・承認はしません。4ステージのまま、状態機械・状態ファイル・自動遷移を追加しません。ステージの位置は成果物の frontmatter、監査ログ、Git から導出します（§3・P-2）。

## 状態と人の関与の接続

| 場面 | 人の操作 | 記録・適用 | Skill がすること |
| --- | --- | --- | --- |
| 設計の採択（確認点） | rules.md の checkpoints が topic なら `vouch confirm design`、unit なら `vouch confirm design unit <Unit ID>`、section なら `vouch confirm design section <節 ID>` | UserPromptSubmit フックが design.md の対象の内容に結び付けた checkpoint.confirmed を記録 | design.md の下書きと採択の依頼を1回だけ示す。採択を代行せず、確認後に design.md を変えたら再確認が要ることを示す |
| Intent 承認 | `vouch review` → `vouch approve <ゲート ID>` | 確認点がそろった時だけフックが intent.md を approved にする（既存） | Build の Skill は approved と承認の証跡を確認してから始める。未承認なら実装せず入力の案内を1回だけ返す |
| Build 中の先送りできない判断 | 構造化質問への回答 | 回答は decisions.md に人の言葉で残す。質問イベントの記録フックは未実装 | 未回答なら既定案で進め、Brief §7 に「Q-n 未回答・既定 X」を載せる。既定案を作れない時だけ止まる範囲を示して止まる |
| PR 承認 | 人が Brief を読んで PR をマージ | Git（`gh pr merge` と main への push はガードが拒否、既存） | Brief を PR 本文として用意する。マージしない。L でも自動マージしない |
| Learn | rules.md への追記案を採用するか | 人の採択の言葉を decisions.md に残す | 採択された案だけを rules.md の Corrections に追記する。採択前の案は Brief §9 に提案として残す |

design.md の frontmatter は `status: draft` のままです。承認フックは intent.md だけを approved にし、design の採択は checkpoint.confirmed（内容の SHA-256）が証跡です。確認の単位は rules.md の checkpoints で決まります（[承認の境界](approval-boundary.md)）。topic は design.md 全体に1回、unit は Design が required の Unit ごと（共通の節とその Unit の行）、section は design_sections の節ごとです。§18 Q2 が選べるとした B・C の粒度を design.md にも適用するため、design_sections の節 ID と units 節の表の1列目（Unit ID）が確認の対象を決めます。

## 正典 stage-authoring.json

| キー | 内容 | 根拠 |
| --- | --- | --- |
| skills | ステージから Skill 名。workflow.json の stages から intent を除いた3つと一対一 | §15 |
| design_frontmatter | 新規 design.md の frontmatter。intent-draft-frontmatter.schema.json を再利用する | 承認の境界の design 確認 |
| design_sections | summary、ideal、alternatives、diagrams、contract、threats、units、references | §5、§13、§14、§18 Q4 |
| build_sections | summary、units、verification、environment、findings、references、dod | §5、§8、§11、§18 Q5 |
| review_sections | §14 の9節を順に conclusion、behavior、claims、walkthrough、reading-guide、questions、references、sabotage、limitations | §14 |
| brief | deferred（§6）が questions、defaults（§7）が references、unresolved（§8）が sabotage | §10、§14、§18 |
| diff_kinds | 3色の classDef を必ず持つ図の種類（flowchart、classDiagram、stateDiagram-v2） | §14、§18 Q4 |
| evidence | 証拠の書式 test / log / shot / commit | §7 |
| hunks | 読むべき箇所の分類 core / plumbing / tests / generated / rename | §6、§14 |
| review_rounds | reviewer → builder の往復の上限（3） | §5・§9（値は下記） |
| demo | Intent フォルダ内の再現用スクリプト名 demo.sh | §14、§18 Q5 |
| git | Skill のコードフェンスに書ける git のサブコマンド（add、commit、diff、log、merge、push、show、status、worktree） | DOC-3 |

ファイル名は project-documents.json の artifacts（design.md、build-log.md、review.md）と同じ名前のテンプレートを使い、ここで重複定義しません。図の種類・条件・数は diagrams.json、品質層・破壊検査数・依存監査は quality-layers.json、確認点は workflow.json と approval.json、検証環境の既定は workflow.json の verification（local Playwright、services compose、ci demo.sh）が正典です。数と一覧を Skill やテンプレートに書き写しません（STR-5）。

### 往復の上限

§5・§9 は「指摘を戻す（人を介さず、上限あり）」としていますが、値は決定記録にありません。[エージェントの契約](agents.md)も後続の決定事項としていました。止まらない往復を防ぐため、既定値 3 を review_rounds に置きます。これは §10 の「未回答は既定案で進め、Brief に明記する」に倣った実装の既定であり、§18 の決定ではありません。上限に達しても解消しない指摘は Brief §8 の未解決として人に示し、人は PR 承認時に覆せます。値の変更は registry の変更と PR で行います。

### 節の境界と既存フックとの互換

- 3つのテンプレートは `<!-- sec:references -->` を持ちます。引用検査（`vouch citations check`）は既存の成果物ごとに `sec:references` の節を読むためです。Brief では §7「私が決めたこと・仮定・参照元」がその節です。
- build-log.md の最後の節は `sec:dod` です。DoD コマンド（vouch-dod.mjs）は build-log.md の末尾に `<!-- dod -->` の記録を追記するので、記録は常に dod 節の後ろに並び、参照元の節に入りません。Skill とモデルは DoD の記録を書かず、編集しません。
- build-log.md と review.md は frontmatter を持ちません。状態は監査・Git・PR から導出します。review.md は PR 本文になるため、frontmatter を持たせません。

## テンプレート

日英は同じ節 ID・図 ID・欄の印を同じ順に持ちます（DOC-4）。識別子（AC-n、Q-n、D-n、R-n、Unit ID、節 ID、図 ID、`L`・`M`・`H`、`required`・`not-required`、証拠の接頭辞、分類名）は英語のままです（§18 Q6）。未記入の欄と図は記入用であり、完成・検証・承認を意味しません。

### design.md

| 節 | 内容 |
| --- | --- |
| summary | 対象 Unit、Design が必要な理由（H、または計画の `required`）、採択の状況、未確定事項 |
| ideal | 理想形・現状・今回埋める差分・埋めない差分と根拠（§13） |
| alternatives | 代替案とトレードオフ表。「何もしない」を検討し、採否の理由を残す |
| diagrams | components-diff（常設）、sequence（常設）、data-diff（schema-change）、lifecycle（lifecycle-change） |
| contract | 型・スキーマ・データ定義・インターフェースの変更表と、contract 図（public-api-change） |
| threats | 脅威モデル観点表。security 層が required の階層（H）で埋め、他は不適用の理由を残す |
| units | Unit ごとの設計、契約コミットの予定、H の非機能の計測予定 |
| references | 参照元 |

### build-log.md

| 節 | 内容 |
| --- | --- |
| summary | Intent、承認の証跡（intent.approved の ID と版）、Unit の状況、最新の DoD の結果 |
| units | Unit ごとのブランチ・worktree、型付きコミットの列、DoD 記録の行 |
| verification | AC ごとの検証方法（自動テスト / AI 操作 / 人）と証拠、未実施の理由 |
| environment | ローカルの AI 操作検証、サービスのコンテナ構成（compose）、demo.sh、H の非機能の計測 |
| findings | reviewer の指摘 R-n への対応と往復の回数、既定案で進めた判断 |
| references | 参照元 |
| dod | 以降は DoD コマンドだけが追記する |

### review.md（Review Brief）

§14 の9節を固定の順で持ちます。1〜4節に実装コードを書きません（4節の Mermaid 図は置きます）。見出しの行にリスク階層・Unit 数・ファイル数と hunks の分類ごとの数を置きます。

| 節 | § | 内容 |
| --- | --- | --- |
| conclusion | 1 | 何をして、何を変えていないか、判断依頼の有無を3行で |
| behavior | 2 | AC ごとの Before → After。テストの Given / When / Then から書く |
| claims | 3 | 品質層ごとの主張、builder の証拠、reviewer の再現、食い違い |
| walkthrough | 4 | main-flow の sequence 図、UI なら Before / After の画像、design-diff、demo.sh の手順 |
| reading-guide | 5 | hunks の分類で読む・読まなくてよい箇所を示す。5分版と、H は15分版 |
| questions | 6 | 先送りした判断依頼を優先度順に。カード本体は decisions.md |
| references | 7 | D-n、既定を適用した判断依頼（「Q-n 未回答・既定 X」）、採用しなかった案、知識の警告、参照元 |
| sabotage | 8 | 破壊検査の表、その場しのぎの検出、往復の上限に達した未解決の指摘 |
| limitations | 9 | やっていないこと・既知の制限・後回しのリファクタ、Learn の追記案 |

brief の deferred・defaults・unresolved の節には、それぞれ `<!-- brief:deferred -->`・`<!-- brief:defaults -->`・`<!-- brief:unresolved -->` の表を置きます。

### 図と固定3色

図の ID・種類・条件は diagrams.json の design と review の順に、`<!-- diagram:<ID> when:<条件> -->` の直後に置きます（DOC-7）。Mermaid の種類はコードフェンスの先頭語、screenshot は count 個の `shot:` の記入枠、design-reference は design.md の図への参照の記入枠です。

diff_kinds の図は diagrams.json の diff の classDef 3行（added 緑、changed 橙、removed 赤）を原文のまま持ちます。テンプレートにそれ以外の色コードを書きません。sequenceDiagram と erDiagram は classDef を使わず、差分は名前の後の `added` / `changed` / `removed` の語で示します。GitHub の Mermaid の版に依存しない書き方に限るためです。

## Skill

| Skill | 入力 | 出力 | 完了条件 |
| --- | --- | --- | --- |
| vouch-design | 下書きの intent.md（Design が required）、decisions.md、知識レイヤー、コード | design.md の下書き | 差分図・契約・代替案・（H の）脅威観点と参照元を書き、rules.md の checkpoints に合う `vouch confirm design`（unit / section の対象を含む）の案内を1回返した時。採択は人 |
| vouch-build | approved の intent.md と承認の証跡、採択済みの design.md、rules.md | Unit ごとの型付きコミット、build-log.md、demo.sh | すべての Unit の DoD が green で、AC の証拠がそろった時。または止まる範囲を示した時 |
| vouch-verify | 成果物・diff・監査・build-log.md（builder の会話は渡さない） | review.md（Brief）、Learn の追記案 | reviewer が独立に再現・破壊検査を終え、指摘を往復の上限まで戻し、Brief を PR 本文として用意した時。マージは人 |

- 3つとも doctor の成功を前提にし、言語は利用者の指定 → rules.md の language → workflow.json の既定 ja の順で選びます（§18 Q6）。
- 品質層は quality-layers.json の Intent のリスク階層（Unit の最高位）で読み、L 4層・M 8層・H 11層、破壊検査 0 / 1 / 3、依存監査は全階層の DoD です（§18 Q3）。未実行の検査を合格として書きません。
- H は Design が必須で、各 Unit の確認点が加わり（workflow.json の high_risk_adds）、脅威モデル観点表・非機能の計測・実使用の探索的検証が必須、Brief の読むべき箇所は15分版で、人がコアロジックの hunk を読みます。モブ・コンストラクションは任意です（§9）。
- AI 操作による検証はローカル（ハーネス内、Playwright など）が既定です。サービス依存があれば builder が `vouch/knowledge/infra/` の構成でコンテナ（compose）を起動し、同じ手順を Intent フォルダの demo.sh に残します。CI で demo.sh を再実行するかは rules.md の DoD の行として人が決めます（§18 Q5）。
- Build は builder、Verify は reviewer のエージェントを起動します。builder の会話を reviewer に渡しません（§9）。reviewer は指摘を review.md の R-n として builder に戻し、review_rounds に達したら止めます。
- Skill のコードフェンスに書けるコマンドは、runtime.json の commands にある `node "{{HARNESS_DIR}}/hooks/<入口>"` と、git の登録したサブコマンドです。DoD のコマンドは rules.md の表を参照し、Skill に書き写しません。bun・npx・curl・gh を書きません（DOC-3）。
- 監査ログを作成・追記・編集しません。承認・確認・PR のマージを代行しません（R-PROJECT-1、R-PROJECT-3、R-PROJECT-4）。

## 検証の方法

契約・型、失敗する先行テスト、実装の順にコミットします。既存の fixture、golden、元仕様、移行元資料を合格のために変更しません。

- registry：stage-authoring.json がスキーマに合い、未知のキー・10節の Brief・重複した節を拒否すること。skills が workflow.json の stages と一対一、brief の3つが review_sections の6・7・8番目、diff_kinds が diagrams.json の mermaid の中にあること。
- content：日英テンプレートの節 ID と順序、design.md の下書き frontmatter、`sec:references` と build-log の最後の `sec:dod`、diagrams.json どおりの図、diff_kinds の図の3色の classDef と他の色コードの不在、Brief の brief の印、evidence と hunks の記入枠、3つの Skill の frontmatter（on-demand、user-invocable）と workflow の stages との対応、Skill のコードフェンスのコマンドが登録済みの node 入口か git の登録サブコマンドであること、新しいテンプレートの golden（UPDATE_GOLDEN=1 で追加）、原本と配布のバイト一致。
- packaging：両ハーネスの Skill・テンプレートの配布のファイル集合、相対リンクと配布ルート基準パスの実在（DOC-6）。
- 予算：各ステージ Skill 200行、オーケストレータ150行、AGENTS.md 60行、常時読み込み8,000トークン（既存の予算テスト）。
- 手製のモデル評価入力は tests/eval/stages に synthetic:true / execution:not-run で置き、入力の構造だけを検査します。構造の合格をモデルの作成・判断の合格、実機での Skill の発見、人の実承認とは扱いません。

## 検出できる範囲と限界

- 自動テストは文書の構造・正典との一致・配布だけを検査します。モデルが Skill に従うか（未承認で Build しない、承認を代行しない、reviewer が独立に再現する、往復を上限で止める）は評価スイートの結果で、ここでは実施済みとしません。
- 機械的な遮断は既存のフックの範囲に限られます（承認前の実装の書き込み、main への push、`gh pr merge`、コミットの型と順序、監査への書き込み）。Skill の文章は新しい遮断を加えません。
- review.requested / review.completed、unit.started / unit.completed、stage.started / stage.completed、learn.recorded を記録するフックは未実装です。question.asked / question.defaulted は登録コマンド、question.answered は人の `vouch answer` の入力でフックが記録します（[再開・ask・report](resume.md)）。Skill はこれらを自分で書かず、Brief には監査にある記録だけを引きます。
- Unit ごとの worktree で DoD を実行すると、build-log.md と監査はその worktree に追記されます。並列に進めた Unit のブランチはこれらの追記が衝突し、監査は手で統合できません。DoD は追記をコミットしないため、Build Skill は Unit の最後の DoD の後に build-log.md と監査ログだけを内容を変えずに記録のコミット（`chore(<Unit>)`、`vouch/` だけの変更）にしてから早送りします。このため Build Skill は Unit を依存順に1つずつ進め、前の Unit を早送り（`git merge --ff-only`）で取り込んだ Intent のブランチから次の Unit の worktree を作ります。§5 の「Unit ごとに worktree で並列」は、フックが Unit ごとの記録を統合する仕組みができるまで行いません。早送りできない時や作業ツリーの変更で取り込めない時は、記録を編集せずに止めます。セッションのフックは Intent のチェックアウト（VOUCH_PROJECT_ROOT）の監査ログに追記するため、そのチェックアウトに未コミットの監査の追記があると早送りは拒否されます。この場合の統合は未解決で、Skill は止まって状況を返します。
- worktree は Intent のブランチのコミットから作られ、未コミットの承認を引き継ぎません。Build Skill は最初の Unit の前に、approved の intent.md・decisions.md・採択した design.md・監査ログが承認コミットとして Intent のブランチにあることを確かめます。DoD コマンドは worktree の中の配布（`{{HARNESS_DIR}}/hooks/`）を使うため、配布をコミットしていないプロジェクトの worktree では起動できないことは未検証の制限です。

## 実装・検証結果

2026-09-30 に実装しました。契約（registry・スキーマ・この文書）は `bdc27d5`、先行テストは `0ffb59a` です。先行テストの時点では、registry の5件が成功し、Skill とテンプレートがないことによる content・packaging の13件が失敗することを確認してから、Skill・テンプレートを追加しました。

- Skill：vouch-design 41行、vouch-build 66行、vouch-verify 61行（予算200行）。オーケストレータは41行、AGENTS.md は35行です。オーケストレータ・AGENTS.md・vouch-intent の「Build 以降は未実装」の記述を、新しい Skill への案内に置き換えました。
- テンプレート：design 151行、build-log 61行、review 127行（日英同じ行数）。新規6件の golden は UPDATE_GOLDEN=1 を明示して追加しました。既存の golden、fixture、元仕様、移行元資料、フック・lib、package.json / lockfile は変更していません。
- skills.test.mjs の許可コマンドの検査を、node の登録入口だけから、stage-authoring.json の git サブコマンドを加えた許可リストに広げました。保護対象の枝への push、強制 push、連結・パイプ、他のプログラムを拒否する負例を加えています。
- enforcement-map は DOC-1・DOC-3・DOC-4・DOC-6・DOC-7・DOC-8・R-PROJECT-1・5・6 の実装済みの根拠を追加し、残る範囲（モデル評価、知識レイヤーの基準図、質問・レビューのイベント記録）を pending に残しました。

| 検査 | Linux / Node.js v22.22.2 |
| --- | --- |
| `npm run check` | 成功、51.1秒（予算90秒） |
| Lint（Biome・markdownlint・dependency-cruiser・knip）・型検査 | 成功 |
| テスト（scripts/test.mjs の段ごと） | 168 / 242 / 5 / 17 / 84 / 14件、計530件が成功、失敗0 |
| 配布の生成と `package:check` | Claude 107、Codex 107、計214ファイルで成功 |

Windows と Node.js 24 は、この環境では実行していません。CI の結果は PR で確認します。

実ハーネスでの Skill の発見・選択、モデルが Skill に従うか（未承認で Build しない、reviewer の独立性、往復の上限、Learn の採択待ち）の評価は実施していません。tests/eval/stages の7件は評価の入力で、実行結果ではありません。

### PR のレビューと CI で見つかった点

PR（otomatty/vouch-workflows#29）への Devin のレビューは Build Skill の2点を指摘し、どちらも手順を読んで再現を確かめました。

- 依存のない Unit を並列にしてよいとしていたため、各 worktree の DoD が同じ相対パスの build-log.md と監査ログに追記し、2つ目の Unit のブランチの取り込みで衝突します。記録の手編集は禁止なので Build を完了できません。Unit を1つずつ進め、早送りで取り込むようにしました。
- 承認のコミットを任意としていたため、未コミットの approved の intent.md と監査ログが Unit の worktree に入らず、最初の DoD が DOD-PLAN で止まります。worktree を作る前に承認コミットを確かめ、なければ先に作るようにしました。

content テストに、Build Skill の `git merge --ff-only` と承認コミットの確認を加えました。

GitHub Actions では Windows の2ジョブが `npm run check` の90秒予算（TEST-12）を超えました。Node.js 22.19.0 は main の `41da839`・`65fa8c8` でも同じ理由で失敗しており、この PR の変更ではありません。Node.js 24.x は main で88秒の成功だったものが、この PR の追加で `package:check` の開始時に予算に達しました。予算は変えずに、この PR が足した実行を減らしました。評価素材と registry の検査を既存の content・registry のテストファイルへ移し（新しいテストの子プロセスを3から1へ）、テンプレートの配布のバイト一致は Intent のテストの既存の配布生成1回で全テンプレートを検査するようにして、配布生成を1回減らしました。検査の内容は減らしていません。

その後の CodeRabbit のレビュー（Major）は、DoD が build-log.md と監査ログに追記した記録がコミットされず、早送りの取り込みで Intent のブランチへ移らないことを指摘しました。手順を読んで再現を確かめ、Unit の最後の DoD の後に2つのファイルだけを記録のコミットにする手順と、その順序の content テストを加えました。stage-authoring.json の git に add と commit を加えています。

### design.md の確認の粒度（Issue #9 の残り）

PR #29 の後、[承認の境界](approval-boundary.md)には「unit / section の design は design.md の節の契約がまだないため（#9）、design.md 全体への1回の確認とする」という先送りが残っていました。design_sections ができたので、未決事項の記録 Q2 の B（Unit ごとに Design 1回）と C（design.md の見出しごとに1回）を design.md にも適用しました。契約（`intent-review.json` の `design unit <Unit ID>`・`design section <節 ID>`、`approval.json` の design_units、型、この文書と承認の境界）、失敗する先行テスト、実装の順にコミットしています。

- topic は従来どおり `vouch confirm design` の1回です。既存の確認の記録と digest は変わりません。
- unit は Design が required の Unit（H を含む）ごとに `vouch confirm design unit <Unit ID>` が要ります。digest は status を draft にした design.md から、units 節の表のほかの Unit の行を除いたバイト列です。共通の部分を変えるとすべての Unit が、ある Unit の行を変えるとその Unit だけが再確認になります。
- section は design_sections の8節ごとに `vouch confirm design section <節 ID>` が要ります。最初の summary の確認は、表題・説明などの最初の節より前の部分と登録外の節も含みます（PR のレビューで、節ごとの確認では冒頭を変えても再確認にならないと指摘されたため）。
- 監査イベントのスキーマは design の checkpoint に unit / section を既に許していたため変えていません。unit と section の両方を持つ design の記録は対象がなく、確認に数えません。
- テンプレートと golden は変えていません。Design Skill と Intent Skill の確認の案内に新しい対象を加えました。

先行テストの時点では、registry の検査が成功し、checkpoints・intent-review の単体テストと Skill の content テストの9件が失敗することを確かめてから実装しました。
