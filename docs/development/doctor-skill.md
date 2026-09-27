# Doctor Skill の契約

## 対象

決定記録 §2・§15・§18 と実装ルール DOC-1〜3・DOC-6・DOC-8 に従い、共通の `core/skills/vouch/SKILL.md` を追加します。今回の実装は doctor のみです。引数なしでは対応範囲を案内し、ask / status / report / migrate とステージ進行は未実装と伝えます。既存の診断ランタイム、イベント、fixture、golden は変更しません。

Claude では `/vouch doctor`、Codex では `$vouch doctor` の明示指定を案内します。後者は [OpenAI の公式 Skill 文書](https://learn.chatgpt.com/docs/build-skills)の `$` による指定と `.agents/skills` の探索に合わせます。仕様書内の `/vouch doctor` は機能名として扱い、Codex の組み込み slash command として登録できたとは主張しません。

frontmatter は既存の skill-frontmatter.schema.json に従い、name / description / user-invocable / reads を持ちます。reads は Vouch の予算分類であり、ハーネスが本文を常時ロードする仕組みを新設する値ではありません。補足の診断説明は references/doctor.md に置き、Skill から必要時に参照します。

## 起動と報告

Skill は自身が配布されたプロジェクトを対象にし、プロジェクトルートから `node "{{HARNESS_DIR}}/hooks/vouch-doctor.mjs"` を実行します。パスに空白・日本語・引用符があってもシェル文字列へ連結せず、作業ディレクトリと引数を分けます。Git 未初期化のプロジェクトも対象です。

Node の独立したバージョン確認やパッケージ取得コマンドは増やしません。doctor の起動を試し、結果を次のように扱います。

| 観測 | 報告と完了条件 |
| --- | --- |
| Node コマンドが見つからない | Node 未導入または PATH 未設定と伝える。registry/runtime.json の nodeMinimum をファイル読み取りで参照して導入を案内する。導入後に再実行するまで診断成功とは扱わない |
| Node は起動したが import エラー・JSON 出力なし・権限エラー | 観測した起動失敗と未診断の範囲を伝える。Node 未導入とは断定しない |
| 終了0かつスキーマに従う JSON の ok:true | 検査対象が合格したと伝える。TOML の意味、信頼設定、実発火、ワークフロー完成は証明しない |
| 終了2かつ JSON の ok:false | 失敗した checks の id / detail と次に直す対象を示す |
| 終了コードと JSON が矛盾・形式不正 | 結果を検証できなかったと伝え、成功にしない |

自動インストール、設定修復、信頼設定の変更、監査イベントの捏造は診断の範囲外です。縮退モードは作りません。診断と案内が出た時点で完了し、利用者から修正を依頼されるまで再試行を続けません。言語は利用者の指定、既存 rules.md の language、workflow.json の既定の順です。

## 配布の契約

manifest の `PackageManifest` JSDoc に任意の tokens マップを追加します。package.mjs は `.md` にだけ宣言されたトークンを置換し、他のファイルはバイトを保存します。未解決の `{{UPPER_CASE}}` トークンがあれば書き込み前に失敗させます。ハーネス名による内容分岐は作りません。Claude は `.claude/skills`、Codex は `.agents/skills` に同じ Skill を配り、HARNESS_DIR の値はそれぞれ `.claude` / `.codex` です。

相対リンクは文書から、HARNESS_DIR を含むパスはプロジェクトルートから解決します。置換後のファイル存在と未解決トークンを検査します。copy / --check の双方で同じ期待バイトを使い、既存のリンク拒否・余分なファイル拒否を維持します。

## 検証範囲

契約・JSDoc → 型検査 → 失敗するテスト → 実装の順でコミットします。

- content では実在する Skill の frontmatter を Ajv で照合し、名前、行数、常時読み込み予算、強制語タグ、コマンド許可リスト、ハーネス非依存を検査する。今回の flat scalar YAML だけを受け付け、未対応の書式や重複キーを黙って解釈しない。
- content でのみ core/skills を読み、置換後の全文を配布物と比較する。packaging / scenario は生成物を読み、ソース Skill を直接読まない。
- packaging は両ハーネスの同内容、配布先、リンク、コマンド参照先を検査する。最小の手製パッケージでトークン置換、非 Markdown のバイト保存、未知トークン時の無書き込みを検査する。
- scenario は配布された説明内のコマンドを空のプロジェクトで実行し、成功・ファイル欠損・Node が PATH にない場合の終了と副作用を観測する。Node 不在は子プロセスの環境だけで再現し、PC の設定は変えない。
- これらは Skill の自動選択やモデルの返答を検証しない。実ハーネスでの発見・選択・返答の評価は CI 外の後続項目として残す。

既存の doctor は runtime.files にあるフックとレジストリを検査します。Skill 文書の欠損や選択不能まで doctor の合格が保証するとは扱いません。既知の性能未達、TOML の意味検証、他の Skill・エージェント・テンプレートは別項目です。
