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

コードの引用は、境界を確認した root 相対のパスを Git の指定コミットから読む。そのコミットの通常ファイル（実行可能ファイルを含む）の存在と行番号を検査し、作業ツリーの未追跡ファイルや追加行で代用しない。作業ツリーを変更しても、引用が指す内容はコミットに保存された版である。Git の参照失敗、ディレクトリ、リンクは拒否する。Git から読んだ内容も監査の観測 digest に含める。

知識レイヤー内と rules.md の引用は、正規化後の root 相対パスが索引の entry に一致し、引用時のバイト digest・更新日が entry と一致することを要求する。別名のパスやコード形式の引用でこの照合を回避しない。一般の文書には索引登録を要求しない。

判断依頼は実際の `### Q-番号:` ごとに intent-authoring.json の question / option marker を用いる。Q-n は記入枠として無視する。状況・選択肢・推奨・既定・影響範囲を空欄や未記入にしない。選択肢表は2〜4件、各案に option / benefits / drawbacks / basis を埋め、basis に検査可能な参照を置く。推奨と既定は理由つき。既定が作れない時は `blocking: 理由` を記す。未回答は承認とみなさない。根拠の意味・選択肢の質は reviewer / 人が検証する。

## 外部 URL と Brief

外部 URL は https と節 fragment を要求する。explorer が通常の許可されたハーネス経路で公式資料を確認し、`vouch/knowledge/external.json` に version:1 と records（url / checked / snapshot / sha256）を保存する。checked は実在する現在以前の UTC 日付、snapshot は root 内の文書、sha256 はそのバイト。記録の日付が索引 entries の最新 updated より古ければ再確認を求める。フックはローカル記録と snapshot の存在・digest だけを検査し、URL の到達性・公式性・内容の意味は保証しない。

status / reviewer は knowledge.refreshed、hook.check の freshness / citation / format、hook.denied.reason を監査から読み、Brief の参照元・警告、§6 の保留、§7 の未回答と既定へ反映する。フックは承認済み Brief を書き換えない。実機 payload の派生テスト、手製入力、実モデル評価、人の実承認を区別する。

knowledge 検査の3イベントは任意の `knowledge` 観測（generation / head / sha256）を持つ。sha256 は検査中に読んだ path とバイト digest の順序付き集合の digest。同一入力の再送は元の時刻と所要時間を保ち、読んだ版が変われば監査の ID 衝突として拒否する。過去の成功を現在の成功として再利用しない。

## 実装と検証記録

2026-09-30、契約 → 失敗する先行テスト → 実装の順で追加した。更新されたコーディング規則は [責務と依存の規則](coding-rules.md)を参照する。鮮度、引用、判断依頼、共通形式、検査・監査の組み立てを別モジュールへ分割し、既存コードの改行を詰める変更は残していない。

Linux / Node.js 24.19.0 で `npm run check` が34.0秒で成功。Lint・型検査、content 33件、registry 63件、packaging 37件、scenario 17件、unit 239件、hooks 90件（負荷テスト8件を含む）の計479件、配布生成・バイト一致を確認した。lib の行99.97% / 分岐98.80% / 関数100%、フック入口は行・分岐100%。知識検査は実際の Git HEAD と6文書を読む20プロセスを3負荷ワーカーの下で測り、p95 62.9ms、2秒予算内だった。

Claude Code 2.1.280 / Codex 0.153.4 の採取済み UserPromptSubmit から作った synthetic 入力で、正常・欠損・古い世代・境界外・リンク、監査イベント3種、同一入力の再送と内容変更時の衝突を検証した。これを新操作の実機採取・モデルの再走査評価・人の実承認とは扱わない。今回、Windows / macOS / Node.js 22 の全体検証、新操作をネイティブ CLI で実行する確認、実モデルによる explorer / reviewer 評価は未実施。元仕様、移行元資料、既存 fixture / golden は変更していない。

これらは明示した知識検査コマンドの実行時フックであり、任意のツールによる全成果物の編集を自動検査するものではない。Skill は成果物を引き渡す前に検査を行い、意味の妥当性は reviewer / 人に残す。監査の永続化エラーは既存 io の契約に従って終了0と診断を返し、成功とは報告しない。

負荷測定は準備・5回ずつの4ケース・集計を個別の5秒以内のケースに分け、同一の Git / 知識 / 監査先を使う。CPU 数 − 1 の負荷は測定前に起動し、全20回の間連続して動かす。全20回の生の値から p95 を計算し、成功回の選別・再試行・ウォームアップの除外をしない。親はケースを順に実行するだけで、準備・測定・集計の制限を緩めない。全体90秒（Windows は150秒。[check 全体の時間予算](check-budget.md)）と知識検査 p95 < 2秒を維持する。

### PR #25 のレビュー修正

2026-09-30、未追跡コード・未コミットの追加行・索引未登録の知識文書が合格する問題を再現し、契約 → 失敗するテスト → 修正の順で追加した。コードは Git の通常ファイルとコミット本文を照合し、知識の引用は索引の path / digest / updated と照合する。両ハーネスの製品入口で、成果物と判断依頼の根拠を検証した。Git の出力も監査の観測 digest に含める。

初版の CI（run 36673105276）では Node 24 の両 OS で負荷測定が5秒の制限に達した。ローカルで同じ失敗は起きなかったが、連続測定を上記のケース構成に分けて条件を維持した。同じ CI の Linux では暗黙の push 先の検査も失敗した。Git の枝情報を取得できない時に許可していた経路を再現し、Intent がない場合も「送信先を検証できない」と遮るよう修正した。CI の当時の Git 取得が失敗した原因はログから特定できない。

修正後の Linux / Node.js 24.19.0 の `npm run check` は39.1秒で成功し、全490件、カバレッジ、型・依存検査、186ファイルの配布生成と一致を確認した。20回の負荷下 p95 は75.4ms。変更後の Windows / Node 22 の結果は PR の CI で確認する。

その後の CI（run 36675238974）では知識・引用・Git 遮断の検査は成功したが、Windows Node 24 の既存の PowerShell 起動検査と、Windows Node 22 の全体90秒制限が残った。push 側（run 36675098273）の Node 22 ではシナリオファイル全体の5秒制限も確認した。Lint・型検査の並列化、cold の PowerShell 検査の独立実行、シナリオのケース単位の制限を追加し、先行テストで静的検査の失敗時に後段を開始しないことを確認した。Linux の再検証は全493件・配布186ファイルが36.8秒で成功した。

run 36676211968 では個別の検査は成功したが Windows の全体90秒制限が残った。非フックの階層も Lint・型検査と同時に進め、すべての合格後にフック検査を実行する。負荷測定中は他の検査を動かさない。いずれかの独立した検査が失敗するとフック・配布を開始しないことを先行テストで確認した。Linux / Node 24.19.0 の最終検証は全493件・配布186ファイルが35.1秒で成功した。CI の合否は全体の制限を含めて確認し、個別テストだけの合格と区別する。

run 36677237735 では Windows Node 24 も成功し、Node 22 は個別検査がすべて成功した後に全体90秒制限に達した。合成負荷の採取入力の検証を親で一度行い、ワーカーには検証済み payload を渡すよう整理した。測定対象・負荷ワーカーが実行するフックのプロセス境界を共用し、起動・入力・終了・測定する範囲は維持する。整理後の Linux / Node 24.19.0 の全493件・配布186ファイルは32.6秒で成功した。
