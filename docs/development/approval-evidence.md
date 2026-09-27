# Intent 承認証跡の照合契約

## 範囲

決定記録 §11・§18、既存の Intent 下書き契約に従います。今回追加するのは、監査レコードと別に観測した入力・成果物を照合する純粋関数です。承認の記録、自然言語による同意の判定、ファイル書き込み、approved への更新、Build の許可は行いません。Skill は下書き専用のままです。

actor:human や ID、ハッシュの一致だけでは真正性を証明できません。モデルが同じデータを作っても照合は一致します。呼び出し側での信頼できる入力採取、発言と承認対象の関連付け、監査書き込みの保護は後続のフックの責務です。今回の API は HookResult を返さず、照合結果を allow に変換する入口も追加しません。

## 入力の根拠

Claude Code 2.1.280 の UserPromptSubmit 実機 fixture は prompt_id、Codex 0.153.4 の同イベントは turn_id を含みます。parseInput は prompt_id も保持します。識別子が欠けても既存フックの一般入力としては有効ですが、承認証跡の照合には使えません。ハーネスはインストール設定から渡し、payload の自己申告で選びません。他方の識別子へフォールバックしません。

実機 fixture の発言は採取用であり承認ではありません。既存の原本・採取記録・golden を変更しません。版付き PreToolUse / PostToolUse は未採取です。この段階では新しい実機フック契約を登録しません。

## 監査と JSDoc

イベント種類は既存の27件のままです。gate.opened に任意の revision、intent.approved に任意の revision / submission を追加します。旧レコードは引き続き schema-valid ですが、証跡照合では missing-evidence となります。checkpoint.confirmed の証跡契約は今回は追加しません。

revision は path: intent.md と小文字64桁の sha256 です。対象 Intent の範囲はレコードの intent と呼び出し側の設定で照合します。revision を持つ gate.opened は source:intent / actor:hook / harness / session が必要です。intent.approved は revision と submission を一組にし、harness / session も要求します。submission は hook_event_name:UserPromptSubmit、field、id、prompt_sha256 を持ちます。Claude の field は prompt_id、Codex は turn_id に限定します。未知の証跡項目と不正なハッシュは拒否します。

JSDoc は contracts.mjs の IntentRevision / Submission / IntentApprovalEvidence と、runtime-contracts.mjs の関数型を正典とします。JSON Schema と実行時バリデータと Ajv の検査結果を合わせます。実行時依存は Node 標準ライブラリだけです。

## 純粋関数の振る舞い

snapshotIntent(text) は先頭の frontmatter が区切り線、status: draft または status: approved、区切り線の3行である文書だけを受け取ります。各行の改行は一貫した LF または CRLF とします。追加キー、重複 status、BOM、未対応の書式、不正な Unicode は null です。一般的な YAML パーサーや状態機械ではありません。status の値だけを draft に置き換えた UTF-8 全文の SHA-256 を計算し、元の status と revision を返します。本文、空白、改行、末尾を正規化しません。status だけの承認更新は同じ版ですが、本文の1文字の変更や改行変換は別の版です。

identifySubmission(input,harness) は検証済み HookInput の UserPromptSubmit から正しい識別子と発言全文の SHA-256 を返します。別イベント、識別子の欠落・空文字、不正な Unicode は null です。発言本文の意味は判定しません。

compareIntentApprovalEvidence(value) は次の順で照合し、最初の不一致理由を返します。

1. gate / approval の監査スキーマとイベント種類。違反は invalid-record。
2. 両レコードの証跡の存在。旧形式は missing-evidence。
3. Intent と設定の一致、両レコードと設定のハーネス一致、receipt の session と入力の session_id の一致。違反は scope。
4. receipt.parent と gate.id の一致、および両イベント ID が異なること。違反は parent。
5. 現在の文書を snapshotIntent で読めることと、両レコードの revision が現在の文書に一致すること。違反は revision。
6. 別途渡した入力と receipt.submission の全フィールド一致。違反は submission。
7. 両時刻が実在する UTC 暦日で、前後関係が正しく、差分が安全な非負整数かつ wait_ms と一致すること。違反は wait。

すべて一致すれば matches:true です。gate と receipt のセッションが違う場合は再開後の応答として照合可能です。receipt と入力のセッションは一致する必要があります。セッションをまたぐ実際の承認許可は後続の統合で検証します。synthetic:true の入力でも整合性は検査できますが、実機での承認や真正性の証拠にはなりません。

elapsedMilliseconds(start,end) は clock.mjs に置きます。UTC の秒と小数秒0〜3桁を受け付け、不正な暦日、ローカル時刻、オフセット、逆転は null です。外部時刻を読みません。

## 検証と未実装

契約コミット後に、手製と明示した証跡の正常系・不一致・破壊ケース、実機入力の識別子保持、Ajv との一致、時刻とハッシュの境界条件を先行テストとして追加します。実装後に unit のカバレッジ、全体 check、配布の一致、追加 lib のミューテーションを検証します。予算と元仕様は変えません。

承認フック、確認点の記録、ゲート発行、発言の同意解釈、入力の信頼性保証、監査の書き込み保護、承認後のファイル変更阻止、承認済み状態への移行は未実装です。enforcement-map の強制済み検査に含めません。今回の照合成功だけで Intent ゲートの完成や承認許可を報告しません。

## 実装・検証結果

2026-09-27 に実装しました。契約は `bd41cbc`、先行テストは `0ebd119`、生存変異から追加した境界テストは `25938df` です。契約の型検査後、照合ライブラリと elapsedMilliseconds の未実装による失敗を確認してから実装しました。ハッシュの末尾に改行を付ける不正例も追加し、正規表現の終端を厳密にしました。

実装は approval.mjs の snapshotIntent / identifySubmission / compareIntentApprovalEvidence と、clock.mjs の elapsedMilliseconds です。FileStore や監査への書き込み、承認の入口は追加していません。新しい実行時依存はありません。実機 fixture、既存 golden、docs/spec、移行元資料を変更していません。

| 検査 | Windows Node.js 22.19.0 | Windows Node.js 24.13.0 |
| --- | --- | --- |
| Lint・型検査 | 成功 | 成功 |
| content / registry / packaging / scenario / unit | 28 / 38 / 10 / 8 / 58件成功 | 28 / 38 / 10 / 8 / 58件成功 |
| hooks と手動コマンド | 19件成功、性能1件失敗 | 19件成功、性能1件失敗 |
| 記録 p95 / 性能ケース時間 | 284.0ms / 5.43秒 | 323.5ms / 6.01秒 |
| lib 行 / 分岐 / 関数カバレッジ | 99.88 / 98.06 / 100% | 99.88 / 98.06 / 100% |
| approval.mjs / clock.mjs の行・分岐・関数 | すべて100% | すべて100% |

両環境とも162件中161件が成功し、check は終了1です。以前から未達の記録 p95 200msに加え、今回は両環境で性能ケースの5秒も超過しました。予算は変更していません。上表は変異検証に基づく追加アサーションと検査記録の追記前の全体実行です。

check が性能検査で止まるため、配布生成と package:check を別に実行しました。両ハーネス合計120ファイルのバイト一致を確認し、配布先 doctor は Claude 48項目、Codex 49項目で成功しました。

Linux / Node.js 22.20.0 は既存 Docker イメージを使い、ネットワークなし・ソース読み取り専用で検証しました。最初の unit 実行は contracts.test.mjs が5.002秒で中断しました。同じスキーマを繰り返しコンパイルしていたため、検証器をファイル内で共有するよう修正しました。入力・アサーション・5秒制限は保持しています。修正は `bbf702d` です。

修正後の Linux は unit 58件と追加レジストリ・配布インベントリ2件が成功し、120ファイルの生成・package:check も成功しました。Linux の全体 check、Lint・型検査、性能測定は今回実行していません。全開発依存のコピーが長引いた初回コンテナは検査前に停止し、Ajv とその既存依存だけをコピーして検証しました。

最終の Windows Node 22 / 24 は unit 各58件を再実行して成功し、上表と同じカバレッジを満たしました。Node 22 は関連 registry / inventory 17件、Node 24 はそれらと照合・時刻の計27件も成功しました。最終 Lint・型検査も成功しています。

## 変更した lib のミューテーション

Windows Node.js 24.13.0 の Stryker 10 で approval.mjs / clock.mjs の2ファイルを測定しました。199変異中192件を検出し、7件が生存、timeout / error / no coverage は0件です。スコアは96.48%で80%基準を上回りました。内訳は approval が142検出・3生存で97.93%、clock が50検出・4生存で92.59%です。

初回は189検出・10生存でした。ゲート側の Intent 不一致、承認側のハーネス不一致、epoch以前から不正な終了時刻への差分を追加して3件を検出しました。既存の入力や fixture は変更していません。残る7件は次のとおりです。

| 変異 | 件数 | 生存の理由と扱い |
| --- | --- | --- |
| Buffer.from の utf8 を空文字にする | 1 | Node の既定エンコーディングも UTF-8 のため同値 |
| submission.field の比較を削除 | 1 | 先行する schema と harness の一致検査が field を同じ値に限定する |
| wait === null の分岐を削除 | 1 | schema-valid な wait_ms は数値なので、続く不一致比較で null を検出する |
| UTC 正規表現の先頭・終端の制限を緩める | 4 | 今回の入力では後続の Date 検証と ISO 再照合も拒否する。すべての文字列に対する同値性は証明していない |

変異の除外や閾値緩和は行っていません。clock の既存 now / newId 部分には生存変異がありません。lib 全体の変更前スコアは未測定なので、全体で生存変異が増えていないとは主張できません。夜間 CI と Issue 作成も pending のままです。

測定には reports/approval-stryker.config.mjs を使い、mutate を上記2ファイル、commandRunner を `node --test --test-concurrency=1 --import=./tests/helpers/no-network.mjs tests/unit/lib/approval.test.mjs tests/unit/lib/clock.test.mjs`、concurrency を4、coverageAnalysis を off、閾値を80にしました。生ログと JSON / HTML レポートはローカルの reports/approval-mutation.* にあります。ネットワークへのレポート送信は行っていません。

## 次の実装

次は信頼できる観測入力と対象文書をゲート発行・承認記録へ結び付ける契約です。必要な PreToolUse / PostToolUse 等の版付き実機 fixture を採取し、作成・確認点・承認イベントの emitter と監査書き込み保護を実装します。自然言語の同意と機械的な照合の責務を分けた統合試験が必要です。現段階では actor:human や matches:true を承認許可に使えません。

Windows の性能未達、実ハーネスでの Skill 評価、残り26イベントの記録、Design / Build / Verify、エージェント、移行、全体のミューテーション CI も残っています。
