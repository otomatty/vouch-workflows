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
