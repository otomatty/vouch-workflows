# 記録フックの起動費用とテスト時間

[Issue #2](https://github.com/otomatty/vouch-workflows/issues/2) の契約と検証記録です。

## 現状

root の別名の修正（[root-alias.md](root-alias.md)）の後、Windows の CI で残った失敗は次の2種類です。

- 記録 p95（HOOK-13、200ms 未満）の超過：レビュー開始は 209〜548ms、承認は 142〜288ms、セッション開始は 128〜169ms でした。Ubuntu Node 22 でも、レビュー開始 252.4ms・セッション開始 250.1ms の超過が一度ずつありました。
- packaging の `tests/packaging/native-environment.test.mjs`：Node 22 ではファイル全体で 5000ms を超えて打ち切られ、Node 24 でも一度 `NATIVE-NODE` で失敗しました。

## 切り分け

`scripts/benchmark-hook.mjs` と `scripts/benchmark-shell.mjs` を、GitHub Actions の Benchmark ワークフロー（run 36398658594・36399362979）で runner ごとに実行しました。各条件20回を交互に測り、起動・終了を含む外側の時計の値です。

| 条件（p50、ms） | Windows Node 22 | Windows Node 24 | Ubuntu Node 22 | Ubuntu Node 24 |
| --- | --- | --- | --- | --- |
| 空の ESM eval | 50.7 | 59.5 | 17.3 | 23.9 |
| `import("node:fs")` を追加 | +4.3 | +3.4 | +3.1 | +3.5 |
| `process.stdin`・`process.stderr` を参照 | +3.5 | +3.0 | +2.6 | +2.9 |
| `node:crypto` で SHA-256 | +4.7 | +4.9 | +3.3 | +5.4 |
| `validation.mjs` とスキーマの読込 | +8.0 | +7.7 | +4.7 | +5.3 |
| no-op（Intent なし） | +26.7 | +30.9 | +16.1 | +21.1 |
| セッション開始の記録 | +42.3 | +48.1 | +21.2 | +25.2 |
| レビュー開始の記録 | +43.5 | +51.4 | +23.1 | +26.6 |

- 起動：空のプロセス自体が Windows で 50〜60ms かかります。これは予算に含めたまま扱います。
- 組み込みモジュール：`import ... from "node:fs"` の ESM ファサードは、`fs.promises` と `ReadStream` などの getter を評価します。その結果、`internal/fs/promises` と stream 一式を読み込みます。`process.stdin`（パイプ）は stream と net を、`process.stderr` は stream を、`node:crypto` は stream と crypto を読み込みます。`process.getBuiltinModule("node:fs")` はどれも読み込みません（Node 22.19.0 / 24.21.0 の `process.moduleLoadList` で確認）。
- I/O：記録条件だけ、裾が大きく伸びました。記録なしの p95 が安定していても、記録の p95 は Ubuntu Node 22 で 150.3ms、Windows Node 24 で 302.5ms（最大 2165.9ms）でした。fsync を含む書込は契約上省けないため、それ以外の費用を減らして余裕を作ります。
- 検証：`benchmark-audit` の監査ログ全件検証は、0件で約0.04ms、2000件で約13〜16msでした。性能テストのログ（20件程度）では主因ではありません。
- 並列実行：CPU 数 - 1 の背景プロセスが no-op フックを起動し続ける条件（`--load`）では、Windows のレビュー開始が p50 147〜176ms、p95 224〜884ms になりました。hooks 階層は1回の check でフックを159回起動し、そのうち99回はカバレッジを書き出します（1回約200KB）。フック1回の費用を減らすと、測られる側と同時に走る側の両方が軽くなります。

PowerShell は、同じジョブで最初の起動に約2.0〜2.4秒、2回目以降は約0.2秒でした。見つからないコマンドの探索は、モジュールの自動読込が走るため、隔離環境では計測の打ち切り（20秒）に達し、継承した環境でも約0.5秒かかりました。`$PSModuleAutoLoadingPreference = 'None'` を指定すると約0.26秒です。packaging の負例テストは、この探索が `probeNode` の 4000ms の打ち切りに達して失敗する経路で合格していました。そのため、毎回約4秒かかっていました。

## 契約

HOOK-13 の p95 200ms 未満、20回の計測、CPU 数並列、起動込みの外側の計測、1ケース5秒、check 全体90秒を維持します。閾値の変更、起動時間の差し引き、ウォームアップの除外、成功回だけの採用、再試行、スキップはしません。

製品フックの起動では、次のとおり組み込みモジュールを扱います。

1. `fs.mjs` は `process.getBuiltinModule("node:fs")` で fs を得ます。ファイル操作を fs.mjs に限る境界（HOOK-6）は変えません。
2. フックの標準入力は、fs.mjs の `readDescriptor(0)` で fd 0 から同期に読みます。`EAGAIN` は短く待って再試行し、読み取り0バイトを入力の終わりとします。1 MiB 以上を拒否する判定は io.mjs に残します。
3. 診断と遮断理由は、fs.mjs の `descriptorWriter(2)` で fd 2 へ同期に書きます。部分書込は残りを書き切り、`EAGAIN` は再試行します。その他の失敗は呼び出し側へ返します。
4. `process.stdin`・`process.stderr` は、hook の既定の経路では参照しません。`RuntimeOptions.stdin`・`stderr` の注入はテスト用に残します。
5. SHA-256 は clock.mjs の `sha256Hex(bytes)`（FIPS 180-4 の JavaScript 実装）で計算し、`node:crypto` を読み込みません。`newId` と Intent・プロンプトのダイジェストの値は変わりません。
6. `process.getBuiltinModule` を使えるのは、fs.mjs の `"node:fs"` だけです。依存検査の対象外になる読込を構造テストで制限し、ネットワーク禁止（HOOK-5）とファイル境界（HOOK-6）を保ちます。
7. validation.mjs の `assertSupportedSchema` は、起動ごとに3つのスキーマ全体を検査し続けます。走査では節点ごとの配列を作りません。検査する位置（properties、oneOf、allOf、items、if、then、else）と拒否の条件は変えません。

この結果、no-op、遮断、記録のどの経路でも、stream・`internal/fs/promises`・net・crypto の組み込みモジュールを読み込みません。

FileStore の原子的置換、fsync、パスとリンクの再検査、冪等性、既存の異常系の検査は変えません。

`probeNode` の PowerShell コマンドは、`node` を解決する前に `$PSModuleAutoLoadingPreference = 'None'` を設定します。PATH 上のアプリケーションの解決は変わりません。見つからない場合は、打ち切りを待たずに失敗します。登録済みのフックコマンド（`harness/codex/hooks.json`）は変更しません。

## 検証方法

- unit：`readDescriptor` が 64KiB を超える入力を全バイト読み、`EAGAIN` を再試行することを一時ファイルの fd で検査します。`descriptorWriter` が部分書込を書き切り、`EAGAIN` を再試行し、その他の失敗を返すことも検査します。unit のプロセスの fd 0 は読みません。
- unit：`sha256Hex` が FIPS 180-4 の例と一致し、0〜300バイト、ブロック境界の前後、1 MiB の乱数入力で `node:crypto` と一致することを検査します。
- unit：`assertSupportedSchema` が、入れ子のすべての位置にある未対応の語彙と型を拒否することを検査します。
- hooks：no-op・関係のないプロンプト・不正なレビューコマンド（遮断理由を書く）と、セッション開始・レビュー開始の記録で、stream・`internal/fs/promises`・net・crypto を読み込まないことを検査します。実際の子プロセスを `runHook` で起動し、テスト用 preload が終了時の `process.moduleLoadList` を書き出します。
- content：`process.getBuiltinModule` の呼び出しが fs.mjs の `"node:fs"` だけであることを検査します。
- packaging：`node` を解決できない負例が、`probeNode` の打ち切りより前に `NATIVE-NODE` で失敗することを検査します。
- 既存の HOOK-13 の3ケースと全体検査を、Windows / Ubuntu × Node 22.19.0 / 24.x の CI とローカルで実行し、結果を区別して記録します。

## SHA-256 の実装を持つ理由

最初の変更（b15347b）の後、Windows の CI で残った超過はレビュー開始の記録でした。Node 24 は p95 203.0ms、Node 22 は 249.7ms です。性能テストの生データ（実行順の20回）を見ると、Windows では分布全体が高く、中央値が約160msでした。hooks 階層の開始直後で、4つのテストファイルが同時に子プロセスを起動する時間帯です。Ubuntu では中央値が約65msでしたが、fsync の待ちとみられる200〜400msの突出がまれに入りました。

記録の経路では、`newId` のために `node:crypto` を読み込みます。これは crypto 本体と、Hash が使う stream 一式を読み込みます。Linux の Node 22.19.0 では、JavaScript の SHA-256 に置き換えると、セッション開始の p50 が 59.4ms から 47.3ms、レビュー開始が 62.5ms から 48.5ms になりました（各30回、交互）。フック1回の CPU 時間が減ると、同時に起動する他のテストとの取り合いも減ります。

この SHA-256 は、署名・鍵・秘密情報を扱いません。公開データから、イベントの識別子と改ざん検出用の指紋を作るためだけに使います。定数時間性は必要ありません。値は `node:crypto` と完全に一致し、既存の golden のイベント ID も変わりません。`node:crypto` へ戻す場合は、clock.mjs の関数を1つ差し替えるだけです。

## 実装

| コミット | 変更 |
| --- | --- |
| b15347b | fs を `process.getBuiltinModule` で得る。標準入出力を fd 0 / 2 の同期 I/O にする。crypto をダイジェスト時だけ読む。`probeNode` で PowerShell のモジュール自動読込を止める |
| fd7e8c5 | SHA-256 を clock.mjs の JavaScript 実装で計算し、`node:crypto` を読まない |
| bec9b61 | スキーマ語彙の検査と値の検証で、節点ごとの配列を作らない（検査の位置・順序・拒否条件は同じ） |

計測用に、`benchmark-hook`（構成要素の切り分け、`--load`、`--profile`）、`benchmark-shell`、`benchmark-suite`（hooks 階層で同時に走る処理と、fsync / fdatasync の保存先ごとの時間）と Benchmark ワークフローを追加しました。どれも予算の判定には使いません。HOOK-13 の3件は、20回の生の値を実行順に出力するようにしました（d9f867e）。値は [hook-startup-samples.md](hook-startup-samples.md) に保存しています。

## 結果

### フック単体

Benchmark ワークフローで、起動・終了を含む外側の時計で各20回を交互に測りました。値は同じジョブの空の ESM eval との p50 の差（ms）です。変更前は run 36398658594・36399362979、変更後は run 36407621357（25f12fa）です。runner が異なるため、差だけを比べます。

| 条件 | Windows Node 22 | Windows Node 24 | Ubuntu Node 22 | Ubuntu Node 24 |
| --- | --- | --- | --- | --- |
| no-op | +26.7 → +15.5 | +30.9 → +14.2 | +16.1 → +6.4 | +21.1 → +8.8 |
| セッション開始の記録 | +42.3 → +27.4 | +48.1 → +25.8 | +21.2 → +10.2 | +25.2 → +13.5 |
| レビュー開始の記録 | +43.5 → +29.6 | +51.4 → +28.6 | +23.1 → +11.8 | +26.6 → +15.0 |

変更後の Windows では、空の ESM eval 自体が p50 50.0〜59.9ms かかります。`--profile` で見たレビュー開始の主スレッドの CPU は約37〜42ms です。内訳は、ESM ローダーと Node の内部処理が約12〜17ms、フックのコードが約6ms、fsync が約5〜6ms、検証が約2.4ms、lstat が約1.3〜1.7ms でした。レビュー開始が読み込む組み込みモジュールは、空の ESM プログラムと同じ106個です（Linux の Node 22.19.0 で確認）。

### ローカル

この作業環境は Linux コンテナ（4 CPU）だけで、Windows の実機はありません。Windows の結果は CI のものだけです。

- 25f12fa の `benchmark-hook`（空の ESM eval との p50 の差）：Node 22.19.0 は no-op +15.1、セッション開始 +20.6、レビュー開始 +22.4ms。Node 24.21.0 は +13.3、+18.0、+20.2ms。
- hooks 階層を Node ごとに3回：すべて成功しました。レビュー開始の p95 は 87.4〜112.1ms（Node 22.19.0）と 91.0〜104.9ms（Node 24.21.0）、承認は 78.1〜103.0ms と 69.3〜91.4ms、セッション開始は 69.4〜77.7ms と 76.4〜81.9ms です。
- `npm run check`（Node 22.22.2）：23〜29秒で成功しました。

### CI

HOOK-13 の p95（ms）です。× は200ms以上で失敗です。CI は `npm run check` 全体、Benchmark は hooks 階層だけを3回実行した結果です。

| 版 | 実行 | Windows Node 22 | Windows Node 24 | Ubuntu Node 22 | Ubuntu Node 24 |
| --- | --- | --- | --- | --- | --- |
| b303f05（着手前） | CI 2回 | 開始 212.8×・364.6×、承認 234.5× | 開始 209.6×・547.7×、承認 287.5× | 成功 | 成功 |
| b15347b | CI push | 開始 249.7× | 成功（開始 154.4） | 成功 | 成功 |
| d9f867e | Benchmark 3回 | 開始 204.8×・235.1×・206.8× | 開始 229.8×・210.2×・244.7× | 最大 116.3 | 最大 156.3 |
| fd7e8c5 | CI 2回 | 開始 208.8×・249.3× | 2回成功 | 2回成功 | 2回成功 |
| fd7e8c5 | Benchmark 3回 | 開始 205.7×・207.8×・219.0× | 3回成功（最大 196.2） | 最大 113.7 | 最大 131.2 |
| e5c4d87 | CI 2回 | 成功、承認 235.0× | 成功、開始 270.1×・承認 299.7× | 2回成功 | 2回成功 |
| e5c4d87 | Benchmark 3回 | 開始 214.2×・221.2×・231.4× | 開始 214.1× が1回 | 最大 108.6 | 最大 107.8 |
| 25f12fa | CI 2回 | 成功（開始 185.0）、開始 332.9× | 開始 371.6×・504.0× | 2回成功 | 開始 210.0×、成功 |
| 25f12fa | Benchmark 3回 | 開始 226.9×・209.2×、185.2 | 3回とも開始 215.3〜1080.1× | 最大 66.3 | 最大 102.2 |
| edfe0c6 | CI 2回 | 開始 458.5×・257.3× | 2回成功（開始 198.8・191.6） | 2回成功 | 2回成功 |
| edfe0c6 | Benchmark 3回（既定の temp） | 174.2、193.1、開始 372.0× | 3回成功（最大 180.0） | 最大 64.1 | 最大 89.2 |

e5c4d87 と edfe0c6 は計測の追加だけで、製品のコードはそれぞれ fd7e8c5・25f12fa と同じです。fd7e8c5 以降の合格は、Ubuntu が CI 16件中15件・Benchmark 24回中24回、Windows Node 22 が CI 8件中2件・Benchmark 12回中3回、Windows Node 24 が CI 8件中5件・Benchmark 12回中8回です（Benchmark は既定の temp の回だけ）。check 全体は Windows でも 27〜55秒、Ubuntu は 13〜23秒でした。

## 残る失敗

Ubuntu では、失敗は1回だけでした。20回のうち連続した4回（175〜240ms）が遅れたもので、その他は約50msです。

Windows の失敗は、どれもレビュー開始か承認で、20回のうち2回以上が200msを超えた時です。

- 単独では、Windows のレビュー開始は p50 約80〜90ms です。hooks 階層では、4つのテストファイルが 4 vCPU で同時にフックを起動します。この時の中央値は、Benchmark で約160〜170ms、CI で約105〜170ms でした。
- 200msを超えた値は、多くが 210〜290ms、最大 1749.7ms です。25f12fa の Windows Node 24 と edfe0c6 の Windows Node 22 のジョブでは、同じ時間帯に PowerShell の起動（`probeNode` の 4000ms）、scenario の `powershell.exe` の起動やテストファイル、unit の doctor のテストファイルも時間切れになりました。フックの処理に限らず、runner 全体が遅れています。
- Windows のテスト用 temp（`C:\Users\RUNNER~1\AppData\Local\Temp`）では、FileStore と同じ大きさの原子的置換の fsync が p50 5.1〜5.6ms、p95 7.6〜8.3ms でした。`RUNNER_TEMP`（`D:\a\_temp`）では 0.6〜0.7ms です。fdatasync は fsync と差がありませんでした。Ubuntu はどちらも約 0.6ms です。
- hooks 階層で同時に走る処理の単独の時間（Windows）は、`git init` 約47〜48ms（テンプレートなしで約37〜39ms）、配布生成約175ms、フック1回約85〜99ms です。hooks 階層は1回にフックを159回起動するため、並列時の負荷の大半は製品フック自身です。

### 保存先の比較

edfe0c6 の Benchmark（run 36408553085）で、hooks 階層を既定の temp と `RUNNER_TEMP` で交互に3回ずつ実行しました。予算とテストは同じで、sandbox の場所だけが違います。

| ジョブ | 保存先 | レビュー開始 p95（3回） | 60回の中央値 | 200ms 以上 |
| --- | --- | --- | --- | --- |
| Windows Node 22 | 既定（C:） | 174.2・193.1・372.0× | 168.7 | 15回 |
| Windows Node 22 | `RUNNER_TEMP`（D:） | 177.9・236.3×・209.5× | 151.8 | 8回 |
| Windows Node 24 | 既定（C:） | 178.2・180.0・174.6 | 150.6 | 2回 |
| Windows Node 24 | `RUNNER_TEMP`（D:） | 158.5・157.0・160.8 | 138.9 | 0回 |

D: では Windows の中央値が約8〜10%下がり、承認とセッション開始の200ms超えはなくなりました。ただし Windows Node 22 のレビュー開始は3回中2回失敗しました。Ubuntu はどちらでも200ms以上がなく、差もありませんでした。

## 判断が必要な事項

製品側で減らせる費用は、この変更でおおむね使い切りました。Windows の単独のレビュー開始 p50 約80〜90ms のうち、約50〜60ms は空の Node の起動です。残りの主な費用は ESM ローダー（Node 22 は Node 24 の約2倍）と fsync です。hooks 階層では、4 vCPU で4ファイルが同時にフックを起動するため、中央値が約2倍になります。Windows Node 22 のレビュー開始は中央値が150〜170msで、20回中2回が200msを超えると失敗します。

Issue #2 の条件（閾値、20回、CPU 並列、起動込み、fsync を変えない）のままでは、Windows の CI で安定して合格する見込みはまだありません。次のどれを採るかは所有者の判断です。

1. 現状の改善をマージし、Issue #2 は Windows の CI の未達として残す。変更は最小ですが、Windows の CI は不安定なままです。
2. CI の Windows ジョブだけ、`TMP`・`TEMP` を `RUNNER_TEMP` に向ける。製品、予算、計測方法は変わりません。中央値は約10%下がりますが、Node 22 は上の比較で3回中2回失敗しました。単独では足りません。sandbox のパスに `RUNNER~1` の 8.3 名が入らなくなります。Issue #18 の junction の検査は残ります。
3. HOOK-13 の計測条件を見直す。たとえば、性能テストの間は他のテストファイルと同時に走らせない、または4 vCPU より大きい runner を使うなどです。Issue #2 が維持を求める「CPU 並列」の変更にあたるため、所有者の決定が必要です。

推奨は1です。そのうえで、3の計測条件の見直しを別の Issue で決めることを勧めます。2は1や3と組み合わせる補助としてなら有効です。
