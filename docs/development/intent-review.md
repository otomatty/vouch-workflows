# Intent レビュー記録フック

## 範囲と根拠

決定記録 §11・§18 と承認証跡の契約に従い、gate.opened / intent.approved の製品 emitter を追加します。両ハーネスで版付き fixture のある UserPromptSubmit を使う、明示操作専用の記録入口です。普通の文章の同意解釈はしません。既存 Skill の下書き専用という終了条件は変えません。

承認の監査記録と、承認を信頼してファイル変更を許可する検査は別です。この入口は status を書き換えず、承認コミットや Build を開始しません。モデルによる監査ファイル・フック設定の改変、任意のプロセスからの stdin 偽装を防ぐ真正性境界は未実装です。この入口の記録だけを approved への変更許可には使えません。

## 明示操作

VOUCH_PROJECT_ROOT / VOUCH_HARNESS / VOUCH_INTENT はインストール側の設定です。対象を未設定なら何もしません。stdin やコマンド引数から対象 Intent を推定しません。

- `vouch review` は設定された Intent の draft 文書を読み、版に結び付いた gate.opened を記録します。人がレビューを始めるための補助操作です。モデルがこの入力を人の代わりに送ることや、通常の下書き保存をレビュー依頼と見なすことは想定しません。
- `vouch approve evt_<64桁の小文字ハッシュ>` は提示されたゲートに対する明示的な承認入力を記録します。改行、余分な空白、前後の文章を許容せず、完全一致だけを扱います。自然文をこの形式へ自動変換しません。

コマンド語彙は intent-review.json と JSON Schema、JSDoc は ParseIntentReviewCommand が契約です。該当しない入力は副作用なしです。review / approve の語に続く不正な構文は終了2で理由を返し、記録しません。対象ファイル不在・未対応 frontmatter・draft 以外・入力識別子不在・ゲート欠落・対象の版やスコープの不一致・不正な時刻も同様です。

この入口が扱った明示操作は、記録成功時も終了2と stderr の機械可読な理由 ID を返し、入力をモデルへ進めません。VOUCH-REVIEW-RECORDED はゲート ID、VOUCH-APPROVAL-RECORDED は承認記録 ID を含みます。これらは記録操作の完了であり、ファイル変更を許可したという意味ではありません。予期しない I/O・競合・実装エラーは既存 HOOK-2 に従い終了0の診断になり、記録成功とは扱いません。

## 保存と再送

io が検証済み FileStore の readText を HookContext へ渡します。HookMain は、この読み取りポートが必須の ReadyHookContext を受け取ります。設定入力の HookContext と実行時の契約を区別します。読み取り先は vouch/intents/<設定されたintent>/intent.md だけです。FileStore のパス境界・リンク拒否・UTF-8 検証を使います。成果物本文や人の発言本文は監査へ複製しません。

gate.opened の ID は session、event type、harness、intent、入力IDの種類と値から作ります。版を ID の材料にせず、同じ入力IDを別の版へ付け替えた再送を新しい操作にはしません。ts は同じ ID の最初の記録を保持します。記録には actor:hook / source:intent / session / harness / revision を含めます。

intent.approved の ID も同じ規則です。入力IDを別ゲートへ付け替えた場合は既存監査との競合です。親ゲートと承認記録の scope / revision / submission / wait_ms を照合ライブラリで検査します。wait_ms はゲート時刻から入力をフックが観測した時刻までです。実測の人の作業時間とは呼びません。承認の再送では最初の ts / wait_ms を保持します。別セッションからでも、同じ設定 Intent・harness・文書版・親ゲートを明示していれば記録できます。

synthetic:true の既存ゲートや承認記録を製品入口は使いません。証跡のない旧形式ゲートも使いません。AuditStore の append は全バッチ検査・ロック・原文保持・同一 ID の内容照合を行います。ログへの追記失敗は記録完了になりません。

## 実機と検証の区別

[Claude のフック文書](https://code.claude.com/docs/en/hooks)と[Codex のフック文書](https://learn.chatgpt.com/docs/hooks)を参照し、Windows の実機で使う登録コマンドは終了コードを引き継ぎます。既存 UserPromptSubmit の採取原本を基準に、対象 cwd・明示コマンドなどを変えた契約テストは synthetic とします。

今回の Claude Write の前後イベントは[採取記録](../../tests/fixtures/captures/tool-capture.md)に保存しました。Codex のツール系採取はポリシーで止まったため未完了です。いずれも今回のレビュー記録フックの正例を偽装するためには使いません。

契約・型検査、失敗する先行テスト、実装の順でコミットします。監査の完全な新規 golden、両ハーネスの同文別入力・再送・版変更・親違い・合成証跡・不正入力・パス境界・書き込み失敗を検証します。既存 golden、元仕様、移行元資料、既存実機 fixture は変更しません。追加したフックの配布・登録・doctor を検証し、実機の記録確認と子プロセスの再現テストを分けて報告します。
