# 判断依頼の記録

人に決めてもらう論点は decisions.md の Q-n カードに書く（状況・選択肢・メリット・デメリット・根拠・推奨・未回答時の既定・ブロックと影響範囲）。カードを書いた後、問いの発生と既定の適用は登録したコマンドで監査に記録し、人の回答はフックが記録する。モデルは監査を書き足さない。根拠は決定記録 §10・§11。[R-PROJECT-3]

## 質問を出す

カードの「未回答時の既定」は選択肢の ID（A など）を含めて書く。既定案を作れない時だけ `blocking: <理由>` と書く。対象 Intent は環境変数 VOUCH_INTENT で指定されたものである。

```sh
node "{{HARNESS_DIR}}/hooks/vouch-question.mjs" ask <Q-n>
```

コマンドは decisions.md のカードから選択肢の数と既定を読み、question.asked を記録する。カードが不完全なら記録せず理由を返すので、カードを直してから実行し直す。同じ Q-n の再送は最初の記録を保つ。記録後にカードを変えた問いは、新しい Q-n として出し直し、元の Q-n を参照する。

ハーネスの構造化質問（Claude の AskUserQuestion、Codex の request_user_input）が使えれば選択肢を示す。人には、回答を `vouch answer <Q-n> <選択肢 ID>` と入力するよう伝える。構造化質問の回答やチャットの言い換えは記録された回答ではない。

## 回答と既定適用

人が `vouch answer <Q-n> <選択肢 ID>` を入力すると、UserPromptSubmit フックが question.answered（actor:human）を記録する。この入力は確認点の確認でも Intent・PR の承認でもない。回答・確認・承認を互いの代わりに数えない。[R-PROJECT-1]

回答がなくても進めない部分だけを待ち、他は既定案で進める。既定で進めると決めた時に記録する。

```sh
node "{{HARNESS_DIR}}/hooks/vouch-question.mjs" default <Q-n>
```

コマンドは question.asked に記録した既定で question.defaulted を記録する。人が回答済み、問いが未記録、既定がない（blocking）時は記録しない。既定案が作れない問いだけ、止まる Unit と理由を示して人の回答を待つ。他の Unit は止めない。[R-PROJECT-6]

既定適用は人の回答ではない。Brief §7 に「Q-n 未回答・既定 X」として question.defaulted の ID とともに載せ、人は PR 承認時に覆せる。覆す回答が記録されたら builder に戻して直し、reviewer をやり直す。[R-PROJECT-6]
