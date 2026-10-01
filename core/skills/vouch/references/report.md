# 監査の集計

`/vouch report`（Codex は `$vouch report`）は、明示した Intent の監査ログを集計し、時間・回数・待ち時間を根拠付きで要約する。分析用のダッシュボードや集計ファイルは作らない。根拠は決定記録 §11。

## 前提と実行

[doctor](doctor.md) を先に実行し、Node が使えることを確かめる。Node が使えなければ集計は未実施と伝え、手で JSONL を数えて代用しない。[R-PROJECT-7]

対象 Intent は環境変数 VOUCH_INTENT で指定されたものである。未指定なら候補を示して指定を求める。

```sh
node "{{HARNESS_DIR}}/hooks/vouch-report.mjs"
```

コマンドは読み取りだけを行い、JSON を返す。checks と report の形式は `{{HARNESS_DIR}}/registry/doctor-report.schema.json` にある。REPORT-AUDIT が不合格なら、不正な行番号と重複 ID を示し、読めた記録だけの部分的な集計として扱う。監査を修復しない。[R-PROJECT-3]

## 実測・欠損・synthetic・推定

- 実測：report.types の measures にある n・sum・min・max と examples のイベント ID。値は監査に記録された数値だけである。
- 欠損：missing は、その計測値を持たない記録の数である。欠損を 0 とみなさず、取得できないハーネスの値（Codex の tokens など）はそう示す。
- synthetic：synthetic の記録は count に含むが計測値から除く。実測と混ぜない。
- estimated：v2 から移行した記録のうち、時刻や所要時間を隣接する記録から求めたもの。count と estimated に数えるが計測値から除く。実測として示さない。
- 推定：コマンドの出力にない値（ts の差から求めた時間、割合の推計など）を示す時は「推定」と明記し、使ったイベント ID を添える。

unpaired は、対になる終了の記録がない開始の記録である。未完了・中断・記録漏れのどれかは推測せず、事実として示す。[R-PROJECT-2]

## 返す内容

対象 Intent、読めた記録の数と範囲、種別ごとの実測値と欠損、synthetic の数、対のない記録、推定した値とその根拠を簡潔に返す。JSONL はそのまま jq・DuckDB・表計算でも扱えると伝えてよい。集計の中で編集、承認、回答、既定適用をしない。
