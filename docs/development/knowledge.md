# 知識レイヤー・引用・判断依頼の契約

決定記録 §12・§10・§18 を正典とする。実行時依存は Node / Git のみで、フックはネットワークを使わない。

## 配置と世代

`vouch/knowledge/index.json` を knowledge-index.schema.json に従う索引とする。version は1、generation は走査した Git HEAD の完全な SHA、scope は explorer が決めた diff / full。entries は path / sha256 / updated を持つ。sha256 は UTF-8 ファイルの正確なバイトの digest、updated は文書 frontmatter の `updated: YYYY-MM-DD` と一致する。日付は実在日付で、未来を許さない。

配置は `vouch/knowledge/codekb/`、`vouch/knowledge/diagrams/`、`vouch/knowledge/design/`、`vouch/knowledge/infra/`、`vouch/knowledge/background/` と `vouch/rules.md`。索引は各層を最低1文書含む。基準図は diagrams.json の components（常設）、data（DB がある時）に従う。索引の更新はモデルの成果物であり、更新したという監査証跡はフックだけが記録する。digest の一致は分析や図の意味の正しさを証明しない。

## 操作と鮮度

既存 UserPromptSubmit の製品入口に `vouch knowledge check`、`vouch knowledge refresh`、`vouch citations check` を追加する。明示した VOUCH_INTENT の監査先を使い、prompt_id / turn_id がなければ記録しない。処理済みの操作は exit 2 と stderr で伝え、モデルへ同じ指示を送らない。未設定の Intent は既存どおり no-op。

check は HEAD と generation、全 entry の存在・digest・更新日を比較する。古さと欠損は hook.check（freshness）の stale / missing、詳細は hook.denied.reason に記録する。refresh は同じ検査の合格時だけ knowledge.refreshed を記録し、scope は索引から読む。フックは再走査範囲の選定・文書更新をしない。explorer は失敗理由、旧世代、新 HEAD、Git 差分を読んで調査範囲を決め、索引と基準図を更新してから refresh を実行する。

## 参照書式と判断依頼

`vouch citations check` は現在の Intent の intent.md（必須）、存在する design.md / build-log.md / review.md、decisions.md（必須）を検査する。各成果物は `<!-- sec:references -->` の節に実際の Markdown link を1つ以上置く。通常の案内リンクは引用として扱わない。

ローカルコードは `[説明](path:行@完全SHA)`、文書は `[説明](path#節ID@YYYY-MM-DD)`。知識文書も更新日を使い、索引の generation と HEAD、digest を別に検査する。path はプロジェクト root からの相対パス。境界外・絶対パス・リンク・欠損・行範囲外・節欠損・世代違いを拒否する。節は `<!-- sec:ID -->` または `id="ID"` の明示 ID に限る。文書更新日は frontmatter で一意に定義する。

判断依頼は実際の `### Q-番号:` ごとに intent-authoring.json の question / option marker を用いる。Q-n は記入枠として無視する。状況・選択肢・推奨・既定・影響範囲を空欄や未記入にしない。選択肢表は2〜4件、各案に option / benefits / drawbacks / basis を埋め、basis に検査可能な参照を置く。推奨と既定は理由つき。既定が作れない時は `blocking: 理由` を記す。未回答は承認とみなさない。根拠の意味・選択肢の質は reviewer / 人が検証する。

## 外部 URL と Brief

外部 URL は https と節 fragment を要求する。explorer が通常の許可されたハーネス経路で公式資料を確認し、`vouch/knowledge/external.json` に version:1 と records（url / checked / snapshot / sha256）を保存する。checked は実在する現在以前の UTC 日付、snapshot は root 内の文書、sha256 はそのバイト。記録の日付が索引 entries の最新 updated より古ければ再確認を求める。フックはローカル記録と snapshot の存在・digest だけを検査し、URL の到達性・公式性・内容の意味は保証しない。

status / reviewer は knowledge.refreshed、hook.check の freshness / citation / format、hook.denied.reason を監査から読み、Brief の参照元・警告、§6 の保留、§7 の未回答と既定へ反映する。フックは承認済み Brief を書き換えない。実機 payload の派生テスト、手製入力、実モデル評価、人の実承認を区別する。
