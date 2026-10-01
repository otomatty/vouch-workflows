---
name: vouch-build
description: "Build an approved Vouch Intent unit by unit: contract, failing test, implementation and refactor commits, DoD records, AC evidence and a reproducible demo. Refuses to start without a person's recorded approval."
user-invocable: true
reads: on-demand
---

# Build

承認済みの Intent を Unit ごとに契約 → テスト → 実装の順で作り、DoD の記録と AC の証拠をそろえて Verify に渡す。根拠は決定記録 §5・§8・§11・§18 Q3 / Q5。
記録・遮断はフック、判断はモデルが担う。この Skill は承認・確認・PR のマージをしない。[R-PROJECT-1]

## 開始の条件

同じ配布先の [doctor](../vouch/references/doctor.md) を実行する。Node 不在や診断失敗なら実装せず、結果を返す。[R-PROJECT-7]
対象は利用者が指定した Intent だけにする。DoD とガードはハーネス起動前に利用者が設定した VOUCH_INTENT の Intent を使うので、指定と違えば設定を利用者に求め、推測で進めない。
次がそろった時だけ始める。intent.md の frontmatter が approved で、監査ログに同じ版の intent.approved と親の gate.opened がある（読み方は [status の説明](../vouch/references/status.md)）。Design が必要なら、design.md の現在の内容に結び付いた design の checkpoint.confirmed がある。
そろわなければ実装・テスト・build-log.md を書かない。人が `vouch confirm <対象>`、`vouch review`、`vouch approve <ゲート ID>` を入力するとフックが記録・適用することを1回だけ案内する。会話での「承認します」を承認とせず、approved に変更しない。フックの遮断（VOUCH-BUILD-UNAPPROVED）を迂回しない。[R-PROJECT-1]
承認済みの計画・AC・Unit・design.md を変えない。変更が必要なら止め、新しい Intent の下書きとして提案する。

## 記録の置き場所

build-log.md（名前は `{{HARNESS_DIR}}/registry/project-documents.json`）がなければ、日本語は `{{HARNESS_DIR}}/templates/ja/build-log.md`、英語は `{{HARNESS_DIR}}/templates/en/build-log.md` から作る。言語は利用者の指定、vouch/rules.md の language、`{{HARNESS_DIR}}/registry/workflow.json` の既定の順に選ぶ。節は `{{HARNESS_DIR}}/registry/stage-authoring.json` の build_sections が正典である。
最後の dod 節の後ろは DoD コマンドだけが追記する。その記録と監査ログを書き換えない。承認の証跡・コミット・DoD の記録の ID と行を要約に引く。[R-PROJECT-3]

## Unit の進め方

worktree は Intent のブランチのコミットから作られ、未コミットの変更を引き継がない。最初の Unit の前に、approved の intent.md、decisions.md、採択した design.md と監査ログが Intent のブランチにコミットされていることを `git status` で確かめ、なければ承認コミットを先に作る。承認コミットは内容を変えずにコミットするだけで、監査ログを編集しない。[R-PROJECT-3]
計画の表の依存順に Unit を1つずつ進める。各 Unit の DoD は、その worktree の build-log.md と監査ログに追記する。並列に進めた Unit のブランチはこれらの追記が衝突し、記録は手で統合できないため、前の Unit を取り込んだ後の Intent のブランチから次の Unit を始める。各 Unit は `vouch-builder` エージェントに Intent と Unit ID を渡して起動し、builder は専用の worktree と Unit のブランチで作業する。builder の定義にない権限を与えない。

```sh
git worktree add "<Unit の worktree>" -b "<Unit のブランチ>" "<Intent のブランチ>"
```

コミットの件名は `<type>(<Unit>): <説明>` とし、型と順序は `{{HARNESS_DIR}}/registry/build.json` が正典である。契約（DoD 合格）→ 失敗するテスト（DoD 不合格）→ 実装（DoD 合格）→ refactor の順にし、修正は再現するテストを先にコミットする。各コミットの後、`vouch/` の外に未コミットの変更がない状態で DoD を実行する。[R-PROJECT-5]

```sh
node "{{HARNESS_DIR}}/hooks/vouch-dod.mjs"
```

DoD のコマンドは vouch/rules.md の DoD の表にあり、Skill に書き写さない。依存監査はリスク階層にかかわらず DoD の行として実行する（quality-layers.json の dependency_audit）。未設定の行があると DoD は不合格になる。コマンドを推測で足さず、rules.md の設定を判断依頼にして止まる範囲を示す。
失敗の原因分析と修正はモデルが行う。テストを弱めて合格させない。[R-PROJECT-5]

## 品質と検証

品質層は `{{HARNESS_DIR}}/registry/quality-layers.json` で Intent のリスク階層（Unit の最高位）を読む。correctness と contract は DoD の出力で示す。nonfunctional が required なら計測を証拠に残す。数と一覧を本文に書き写さない。
AC ごとに intent.md で宣言した方法で検証する。自動で検証できるものを人に回さない。AI 操作による検証は workflow.json の verification の local を既定とし、ハーネス内でブラウザ・CLI・API を実際に操作する。サービスに依存する時は `vouch/knowledge/infra/` の構成で compose のコンテナを起動する。本番の環境とデータに接続しない。[R-PROJECT-4]
同じ手順を Intent フォルダの demo.sh（stage-authoring.json の demo）に残し、人と CI が再実行できるようにする。CI で再実行するかは、人が rules.md の DoD の行として決める。
証拠は stage-authoring.json の evidence の書式（test / log / shot / commit）で build-log.md に記す。実行していない検証を証拠や成功として書かない。[R-PROJECT-2]
H は Design・各 Unit の確認点・11層がそろった計画で進む。人がモブ・コンストラクションに同席する場合も、承認と確認の入力は人が行う。

## 判断依頼

実装中の判断は、根拠と採らなかった案を decisions.md の D-n に残す。人に決めてもらう必要がある時は Q-n のカードを decisions.md に書き、[判断依頼の記録](../vouch/references/questions.md)に従って問いを記録し、ハーネスの構造化質問が使えれば選択肢を示す。
未回答なら既定案で進め、人の回答と区別して build-log.md の findings と Brief §7 へ引き継ぐ。既定案を作れない時だけ、止まる Unit と理由を示す。他の Unit は止めない。[R-PROJECT-6]

## 取り込みと終了条件

DoD は build-log.md と監査ログに追記するがコミットはせず、早送りの取り込みはコミットだけを運ぶ。Unit の最後の DoD の後、DoD が追記したこの2つのファイルだけを、内容を変えずに Unit のブランチへ記録のコミットにする。件名は build.json の型に従い、`vouch/` だけを変えるコミットにする。[R-PROJECT-3]

```sh
git add "vouch/intents/<Intent>/build-log.md" "vouch/intents/<Intent>/audit/events.jsonl"
git commit -m "chore(<Unit>): record DoD results"
```

その後、次の Unit を始める前に Unit のブランチを Intent のブランチへ早送りで取り込む。早送りできない、または作業ツリーの変更（セッションのフックが Intent のチェックアウトの監査ログに追記した分を含む）で取り込めない時は、build-log.md の DoD 記録や監査ログを編集せずに止め、状況を返す。[R-PROJECT-3]

```sh
git merge --ff-only "<Unit のブランチ>"
```

すべての Unit で、コードを変えた最後のコミットに DoD 合格の記録があり、AC の証拠か未実施の理由がそろったら [Verify Skill](../vouch-verify/SKILL.md) へ渡す。builder の会話は渡さない。
Verify の指摘 R-n が戻ったら、builder が再現するテスト → 修正の順にコミットし、往復の回数を findings に記す。上限は stage-authoring.json の review_rounds である。
main への push、PR のマージ、承認の代行、監査ログの作成・編集、証拠の捏造をしない。[R-PROJECT-1] [R-PROJECT-2] [R-PROJECT-3] [R-PROJECT-4]
