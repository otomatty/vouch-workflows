# builder・reviewer・explorer とエージェント配布

## 範囲と根拠

[Issue #8](https://github.com/otomatty/vouch-workflows/issues/8) の契約と検証記録です。決定記録 §5（4ステージと3エージェント）、§8（V-3 / V-4：reviewer は builder の証拠を鵜呑みにせず自分で再現する）、§9（独立検証、リスク階層、破壊検査）、§12（知識の再走査は explorer）、§13（その場しのぎの検出）、§15（配布物とハーネスの対応表）、§18 Q3（品質層 × リスク階層）に従います。§18 の決定と Q1〜Q6 は変えません。実装ルールは STR-3、STR-6、DOC-1、DOC-2、DOC-6、DIST-1〜DIST-4 です。

workflow.json の3役（builder / reviewer / explorer）だけを定義し、役割を増やしません。エージェントは判断を担うモデルへの指示であり、フックの代わりに記録・遮断・承認をしません。エージェントを起動するステージ Skill（Build / Verify）と、`review.requested` / `review.completed`・`knowledge.refreshed` を記録するフック、知識レイヤーの形式と鮮度・引用の検査（[Issue #7](https://github.com/otomatty/vouch-workflows/issues/7)）は今回の対象外です。

## 原本の形式

原本は `core/agents/vouch-{builder,reviewer,explorer}.md` の3ファイルです。1ファイル80行以内（DOC-2）で、frontmatter は既存の `agent-frontmatter.schema.json`（name、inputs、tools、disallowed）に従います。スキーマは変更しません。

```markdown
---
name: vouch-builder
inputs: [intent.md, design.md, decisions.md, vouch/rules.md, vouch/knowledge/, repository]
tools: [read, edit, shell]
disallowed: [web, delegate, ask, approve, fabricate, edit-audit, push-main, production, weaken-tests]
---

# vouch-builder

役割を1行で書く。この行が両ハーネスの description になる。

## 入力
```

- frontmatter は4キーをこの順で1行ずつ書き、値は `[a, b]` 形式の1行の列です。項目は英小文字・数字・`.`・`/`・`_`・`-` だけです。重複キー・空の列・他の構文は生成時に拒否します。
- 本文は `# <name>`、空行、1行の要約、空行で始めます。要約は両ハーネスの description です。
- inputs は project-documents.json の成果物（intent.md、design.md、build-log.md、review.md、decisions.md、audit/events.jsonl）と `vouch/rules.md`、`vouch/knowledge/`、`diff`（コミット順つきの差分）、`repository`（作業ツリーのコード）から選びます。会話履歴は入力にしません。
- 本文は `## 入力`、`## 成果物`、`## 行わない操作` の節を持ちます。inputs の各項目は `## 入力` に、disallowed のうち操作の各項目は `## 行わない操作` に、バッククォートで囲んだ ID と enforcement-map に登録した規則タグ付きで書きます。

### ツールと操作の語彙

tools と disallowed のツールは、ハーネスに依存しない次の6語です。語彙は `scripts/lib/agents.mjs` が正典で、各エージェントで6語すべてを tools か disallowed のどちらか一方に置きます（許可と不許可の分割に漏れと重なりがない）。

| 語 | 意味 | Claude のツール |
| --- | --- | --- |
| read | ファイルの読み取り・検索 | Read、Grep、Glob |
| edit | ファイルの作成・編集 | Edit、Write |
| shell | コマンドの実行 | Bash |
| web | 外部の文書の取得・検索 | WebFetch、WebSearch |
| delegate | 別のエージェントの起動 | Agent |
| ask | 人への構造化質問 | AskUserQuestion |

disallowed のツール以外の項目は操作の ID です。

| ID | 行わないこと | 規則 |
| --- | --- | --- |
| approve | 承認・確認点の代行、approved への変更 | R-PROJECT-1 |
| fabricate | 実行していない検査・再現を証拠や成功として書くこと | R-PROJECT-2 |
| edit-audit | 監査ログの作成・追記・編集 | R-PROJECT-3 |
| push-main | main への push、PR のマージ | R-PROJECT-4 |
| production | 本番データへの接触 | R-PROJECT-4 |
| weaken-tests | 合格を装うテストの改変・削除・スキップ | R-PROJECT-5 |
| builder-context | builder の会話・思考・自己申告を検証の根拠にすること（reviewer） | R-PROJECT-5 |
| fix-code | 指摘したコードを自分で直すこと。修正は builder に戻す（reviewer） | R-PROJECT-5 |
| keep-sabotage | 破壊検査の変更をコミット・残置すること（reviewer） | R-PROJECT-5 |
| edit-code | 製品コード・テスト・Intent の成果物の変更（explorer） | R-PROJECT-1 |

## 3役の契約

| 役 | 入力 | 許可ツール | 成果物 |
| --- | --- | --- | --- |
| builder | 承認済みの intent.md、design.md、decisions.md、rules.md、知識レイヤー、コード | read、edit、shell | Unit の worktree 上の契約 → テスト → 実装のコミット、DoD コマンドによる build-log.md の記録 |
| reviewer | intent.md、design.md、decisions.md、build-log.md、監査ログ、diff、rules.md、知識レイヤー、コード | read、edit、shell | review.md（観点表、破壊検査の表、指摘 R-n と再現手順） |
| explorer | 知識レイヤー、rules.md、intent.md、コード | read、edit、shell、web | `vouch/knowledge/` の調査結果（観測した commit つき）と参照元つきの報告 |

- builder は Unit ごとに専用の git worktree で作業します。worktree の HEAD が承認済み intent.md を含む Intent のブランチから分かれていることを確かめ、他の Unit の worktree や親のチェックアウトに書きません。Claude では定義の `isolation: worktree` がサブエージェントに一時 worktree を与えます。Claude の既定ではこの worktree は既定のブランチから作られるため、builder は Intent のブランチから Unit のブランチを作って切り替えます。Codex には同じ仕組みがないため、builder が `git worktree add` で作ります（§15 の表）。
- reviewer は builder と別のコンテキストで起動し、入力は成果物・diff・検査結果だけです（§9 図6）。DoD のコマンドを自分で実行し、AC の振る舞いを自分で再現した出力を証拠にします。build-log.md の出力は主張として読み、証拠として引き写しません。別ハーネスでの実行を推奨します。
- explorer は読み取りの調査と `vouch/knowledge/` の更新だけを行います。コード・テスト・Intent の成果物は変えません。知識レイヤーの形式と鮮度検査は #7 の後続で、今回は観測した commit と参照元を書くことだけを求めます。

### 品質層と破壊検査

reviewer と builder は `quality-layers.json` を正典として読み、数を本文に書き写しません（STR-5）。

- reviewer は、Unit のリスク階層で required の層をすべて、optional の層は Intent が求めた時に観点表で判断します。evidence_by に reviewer を含む層（maintainability、rationale、testing、design、root_cause、security、exploration）を本文で名指しし、フックの証拠の層（correctness、contract など）は自分で再実行して確かめます。破壊検査は `sabotage` の件数（L 0、M 1、H 3）を行い、壊した箇所・期待・結果を表にして変更を戻します。依存監査（`dependency_audit`）は全階層の DoD として確かめます。
- builder は evidence_by に builder を含む nonfunctional の層の証拠を H で用意し、correctness の証拠は DoD コマンドで残します。

### 指摘を Build に戻す

reviewer は指摘を review.md の R-n として、再現手順・期待・観測・該当箇所とともに書き、人を介さず builder に戻します（§9 図6）。builder は指摘ごとに契約 → テスト → 実装の順で修正コミットを足し、既存のテストを弱めません。reviewer は新しいコンテキストで同じ手順を再実行します。往復の回数は監査の `review.*` の iteration で数えますが、記録するフックと往復の上限回数はレジストリに未定義です。エージェントは上限を自分で決めず、解消しないまま残った指摘を Brief §8 の未解決として人に示します。上限の値は後続の決定事項です。

既存の予算は変えません。エージェント80行、package.mjs 150行、常時読み込み8,000トークンです。エージェントは常時読み込みに含めません。

## 生成

`scripts/package.mjs` は manifest の対応表に任意の `render` 関数を持てるようにします。`render(name, text)` はトークン置換後の Markdown を受け取り、配布先の相対パスと内容を返します。package.mjs 自身はハーネスで分岐せず、内容の差は `harness/<name>/` のファイルで表します（STR-6）。

| ハーネス | 変換 | 配布先 |
| --- | --- | --- |
| Claude | `harness/claude/agent-markdown.mjs`：frontmatter を name、description、tools、disallowedTools（語彙から Claude のツール名へ写像）と、builder だけ `isolation: worktree` に置き換え、本文はそのまま | `.claude/agents/vouch-*.md` |
| Codex | `harness/codex/agent-toml.mjs`：name、description、sandbox_mode、developer_instructions の TOML。developer_instructions は固定の前文、inputs・tools・disallowed の3行、空行、本文 | `.codex/agents/vouch-*.toml` |

- Codex のカスタムエージェントにはツールごとの許可リストがないため、許可・不許可は developer_instructions の3行と本文の節で伝え、書き込みは sandbox_mode で制限します。tools に edit を含めば `workspace-write`、含まなければ `read-only` です。3役とも edit を持つため現在は `workspace-write` です。
- 入れ子は Codex の `.codex/config.toml` の `[agents] max_depth = 1` で止め、Claude では3役とも Agent を disallowedTools に置き、原本でも delegate を disallowed にします。
- `agent-toml.mjs` は逆変換 `fromToml` も持ち、生成した TOML から原本の Markdown をバイト単位で復元します（DIST-4）。逆変換は生成する部分集合だけを読み、コメント1行、`key = "..."`（JSON 互換のエスケープ）、`key = '''...'''` 以外を拒否します。本文に `'''` や CR を含む原本は生成時に拒否します。

## テストを先に固定する項目

- content：3ファイルが workflow.json の agents と一対一で、frontmatter がスキーマと原本の形式に合うこと。語彙と分割、inputs の許可集合、`## 入力`・`## 成果物`・`## 行わない操作` の節と規則タグ、ハーネス固有パスの不在（STR-3）、builder の worktree、reviewer の quality-layers.json と reviewer の層・sabotage・dependency_audit の参照、builder の nonfunctional、explorer の `vouch/knowledge/`。
- packaging：両ハーネスの配布のファイル集合、Claude の frontmatter（ツール名の写像、disallowedTools、builder だけ isolation）と本文の一致、Codex の TOML の各キー、sandbox_mode、前文の3行、`fromToml` による原本への往復、`max_depth = 1`、本文の相対リンクと配布ルート基準パスの実在（DOC-6）、`--check` のバイト一致。
- packaging（手製入力）：`render` が対応表の全ファイルに適用され、`--check` と余分なファイルの検出が変換後のパスで働くこと。変換器が重複キー・未知の語・分割の漏れと重なり・要約の欠落・`'''`・CR を拒否し、TOML の文字列をエスケープすること。
- 既存の Claude / Codex の配布テストは、Skill と同じく agents 配下を別テストで検査するよう除外に加えます。検査内容は減らしません。

## 検証の区別

自動テストは原本・生成物・往復の構造を検査します。実際の Claude / Codex が生成物をエージェントとして読み込むことはテストでは保証しません。実機で読み込みを観測した場合は、下の記録に版と手順を分けて残します。実際のモデルが役割を守るか（worktree の隔離、reviewer の独立性、破壊検査の実施）の評価は別 Issue の結果として扱い、ここでは実施済みとしません。
