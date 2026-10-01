# check 全体の時間予算

[Issue #28](https://github.com/otomatty/vouch-workflows/issues/28) の契約・判断・検証の記録です。

## 判断

リポジトリの所有者の判断で、`npm run check` 全体の時間予算（TEST-12）を次のとおり見直しました（2026-10-01）。性能予算テストは必須の check に残します。

| キー（`core/registry/budgets.json` の `timing`） | 値 | 使う場所 |
| --- | --- | --- |
| `checkTimeoutMs.default` | 90000（90秒） | `scripts/check.mjs` の check 全体の締め切り（Linux・macOS） |
| `checkTimeoutMs.win32` | 150000（150秒） | 同上（Windows） |
| `testFileTimeoutMs` | 90000（90秒） | hooks・scenario の階層と Benchmark の `--test-timeout`（テストファイル単位）、HOOK-13 の負荷ワーカーの寿命 |
| `testTimeoutMs` | 5000（5秒） | 変更なし。1ケース5秒 |

- check 全体の予算を OS ごとの値にしました。Linux は元資料の90秒のままです。Windows だけ、実測（約100秒）に約50%の余裕を加えた150秒にしました。CI のジョブ全体のタイムアウト（5分）には、Windows の準備（checkout・setup-node・`npm ci`・doctor の約25〜30秒）を含めても収まります。
- これまで `checkTimeoutMs` は、check 全体の予算と、テストファイル単位の上限・負荷ワーカーの寿命を兼ねていました。全体の予算を上げても後者が一緒に緩まないよう、`testFileTimeoutMs` に分けました。値は今までと同じ90秒です。
- 元資料の実装ルール TEST-12（「CI の全体 ≤ 90 s」）と予算表（「テスト全体 ≤ 90 s」）は変更しません。lib の行数予算を 3,000 行から 3,500 行に引き上げたとき（[git-guard.md](git-guard.md)）と同じく、所有者の判断として budgets.json とこの資料に記録します。
- 1ケース5秒（TEST-12）、HOOK-13 の p95 < 200ms・20回・起動込みの計測、再試行・スキップの禁止は変更しません。

## 根拠となる実測

2026-09-29〜10-01 の CI（`.github/workflows/ci.yml`）の全実行のうち、取り消しを除く68実行と再実行6回で、`npm run check` のステップの所要時間を集計しました。再実行で前回の結果が写されただけのジョブは除いています。

| OS / Node | ジョブ数 | 成功 | 成功時の所要時間（最小 / 中央値 / 最大） |
| --- | --- | --- | --- |
| Ubuntu / 22.19.0 | 68 | 65 | 15 / 44 / 52秒 |
| Ubuntu / 24.x | 69 | 66 | 20 / 40.5 / 50秒 |
| Windows / 22.19.0 | 74 | 35 | 31 / 69 / 91秒 |
| Windows / 24.x | 70 | 51 | 30 / 72 / 89秒 |

- Windows の所要時間は、機能とテストを足すたびに伸びています。成功時の中央値は、Node 22 が 9/29 の58秒から 9/30 の75秒に、Node 24 が56秒から85秒になりました。main では `3d7aabc` 71秒 / 67秒（Node 22 / 24）、`d039a0a` 81秒 / 81秒、`65fa8c8` 90秒超 / 86秒、`41da839` 90秒超 / 88秒、`fba295e` 76秒 / 75秒でした。
- TEST-12 の超過は29ジョブで、すべて Windows です。どれもステップが91〜96秒の時点で打ち切られています。打ち切られた段は test:hooks 11件、test 3件、package・package:check 各1件、子プロセスの ETIMEDOUT 7件、ログの末尾から特定できなかったもの6件です。9/30 06:14 以降の Windows Node 22 は、ほぼ毎回この超過で失敗しました。
- PR #26 の `1b1401b`（Windows Node 22、3回とも失敗）では、静的検査の段が約38秒、hooks の通常の段が約27秒かかり、予算テストの段（約30秒）の途中で90秒に達しました。予算テストの p95 はすべて予算内でした。打ち切られなければ、配布の生成と検査を含めて約100秒かかる計算です。
- Ubuntu は最長52秒で、90秒に対して約40%の余裕があります。
- Linux のローカル検証（Node 22.22.0、4 CPU）は、変更前の `fba295e` で42.3秒でした。

同じ期間の Ubuntu の失敗は HOOK-13 の p95 超過（runner の遅れ、[Issue #27](https://github.com/otomatty/vouch-workflows/issues/27)）などで、check 全体の予算の超過はありません。

## 契約

1. `budgets.schema.json` の `timing.checkTimeoutMs` は、必須の `default` と任意の `win32` を持つオブジェクトです。どちらも正の整数で、その他のキーは拒否します。`timing.testFileTimeoutMs` は必須の正の整数です。
2. `scripts/check.mjs` は、実行中の OS（`process.platform`）の値を check 全体の締め切りに使います。その OS の値がなければ `default` を使います。成功時には所要時間と予算を表示します。
3. `scripts/test.mjs` と `scripts/benchmark-suite.mjs` は、hooks・scenario のファイル単位の `--test-timeout` に `testFileTimeoutMs` を使います。その他の階層は `testTimeoutMs`（5秒）です。どちらも `checkTimeoutMs` を読みません。
4. HOOK-13 の負荷ワーカー（`tests/helpers/load-worker.mjs`）の寿命は `testFileTimeoutMs` です。負荷を起動するテストファイルの上限と同じ長さで、異常終了したときの残留を防ぎます。
5. 予算の選択は `scripts/lib/time-budgets.mjs` の関数にまとめ、テストから値を差し替えて検査します。

## 検証方法

- registry：budgets.json がスキーマを満たすこと。数値だけの `checkTimeoutMs`、`default` の欠落、未知の OS のキー、`testFileTimeoutMs` の欠落を拒否すること。予算の値（既定90秒・Windows 150秒・ファイル90秒・1ケース5秒）が判断の記録と一致すること。
- packaging：`checkBudgetMs` が `win32` で Windows の値を、Linux・macOS で `default` を返すこと。`testTimeoutFor` が hooks・scenario でファイルの上限を、その他の階層で1ケースの上限を返すこと。いずれも、キーごとに異なる値を入れた予算で検査します。
- packaging：実際の `scripts/check.mjs` を sandbox で起動し、成功時の表示が実行中の OS の予算になっていること。
- packaging：`scripts/check.mjs`・`scripts/test.mjs`・`scripts/benchmark-suite.mjs`・`tests/helpers/load-worker.mjs` が、それぞれ意図した予算を読み、意図しないキーを参照しないこと。
- CI：4ジョブ（Ubuntu / Windows × Node 22.19.0 / 24.x）を複数回実行し、各ジョブの所要時間と予算の余裕を記録します。

## 検証結果

| 検査 | Linux / Node.js v22.22.0（4 CPU） |
| --- | --- |
| `npm run check` | 成功、42.0秒（予算90秒）。表示は `Implemented checks passed in 42.0s (budget 90s).` |
| 追加したテスト | registry 2件、packaging 3件（`time-budgets.test.mjs`）、check-runner の予算の表示の検査が成功 |

Windows の値（150秒）を使う経路は、`checkBudgetMs` のテストと CI の Windows ジョブで確認しました。

### CI

実装（`4178661`）の push と、その後の workflow_dispatch 3回、計4回の CI を実行しました。値は `npm run check` のステップの所要時間（秒）で、括弧内は予算に対する余裕です。Windows Node 22 の push の回のログは `Implemented checks passed in 96.7s (budget 150s).`、Windows Node 24 は `85.9s (budget 150s)` でした。

| run | Ubuntu / 22.19.0 | Ubuntu / 24.x | Windows / 22.19.0 | Windows / 24.x |
| --- | --- | --- | --- | --- |
| 36794941936（push） | 成功 30（60） | 成功 47（43） | 成功 98（52） | 成功 87（63） |
| 36795182225 | 成功 49（41） | 成功 47（43） | 成功 94（56） | 成功 90（60） |
| 36795398808 | 成功 50（40） | 失敗 39：HOOK-13 | 成功 93（57） | 失敗 90：HOOK-13 |
| 36795652546 | 成功 47（43） | 成功 46（44） | 成功 95（55） | 失敗 39：1ケース5秒 |

- check 全体の予算（TEST-12）の超過は16ジョブで0件です。変更前の予算（90秒）では、Windows Node 22 の4回（93〜98秒）はすべて打ち切られていました。
- 成功時の余裕は、Ubuntu が40〜60秒、Windows Node 22 が52〜57秒、Windows Node 24 が60〜63秒です。
- 残る失敗3件は、この Issue で変えない予算によるものです。
  - HOOK-13 の p95 超過2件：Ubuntu Node 24 の承認の適用 240.9ms、Windows Node 24 の open の記録 202.7ms です。runner の遅れによるもので、[Issue #27](https://github.com/otomatty/vouch-workflows/issues/27) で扱います。Windows Node 24 は、予算テストの段を最後まで終えた後に失敗しました（90秒）。
  - 1ケース5秒の超過1件（Windows Node 24、39秒）：scenario の `copied codex registrations confirm, apply the approval and then admit implementation writes` が5000msで打ち切られました。同じ回の packaging では、PowerShell の最初の起動が `probeNode` の 4000ms に達し、`native-environment.test.mjs` の2件が失敗しました（[hook-startup.md](hook-startup.md) の残る課題）。どちらも静的検査の段で起き、hooks・配布は始まっていません。
