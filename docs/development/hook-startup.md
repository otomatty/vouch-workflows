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

この結果、no-op、遮断、記録のどの経路でも、stream・`internal/fs/promises`・net・crypto の組み込みモジュールを読み込みません。

FileStore の原子的置換、fsync、パスとリンクの再検査、冪等性、既存の異常系の検査は変えません。

`probeNode` の PowerShell コマンドは、`node` を解決する前に `$PSModuleAutoLoadingPreference = 'None'` を設定します。PATH 上のアプリケーションの解決は変わりません。見つからない場合は、打ち切りを待たずに失敗します。登録済みのフックコマンド（`harness/codex/hooks.json`）は変更しません。

## 検証方法

- unit：`readDescriptor` が 64KiB を超える入力を全バイト読み、`EAGAIN` を再試行することを一時ファイルの fd で検査します。`descriptorWriter` が部分書込を書き切り、`EAGAIN` を再試行し、その他の失敗を返すことも検査します。unit のプロセスの fd 0 は読みません。
- unit：`sha256Hex` が FIPS 180-4 の例と一致し、0〜300バイト、ブロック境界の前後、1 MiB の乱数入力で `node:crypto` と一致することを検査します。
- hooks：no-op・関係のないプロンプト・不正なレビューコマンド（遮断理由を書く）と、セッション開始・レビュー開始の記録で、stream・`internal/fs/promises`・net・crypto を読み込まないことを検査します。実際の子プロセスを `runHook` で起動し、テスト用 preload が終了時の `process.moduleLoadList` を書き出します。
- content：`process.getBuiltinModule` の呼び出しが fs.mjs の `"node:fs"` だけであることを検査します。
- packaging：`node` を解決できない負例が、`probeNode` の打ち切りより前に `NATIVE-NODE` で失敗することを検査します。
- 既存の HOOK-13 の3ケースと全体検査を、Windows / Ubuntu × Node 22.19.0 / 24.x の CI とローカルで実行し、結果を区別して記録します。

## SHA-256 の実装を持つ理由

最初の変更（b15347b）の後、Windows の CI で残った超過はレビュー開始の記録でした。Node 24 は p95 203.0ms、Node 22 は 249.7ms です。性能テストの生データ（実行順の20回）を見ると、Windows では分布全体が高く、中央値が約160msでした。hooks 階層の開始直後で、4つのテストファイルが同時に子プロセスを起動する時間帯です。Ubuntu では中央値が約65msでしたが、fsync の待ちとみられる200〜400msの突出がまれに入りました。

記録の経路では、`newId` のために `node:crypto` を読み込みます。これは crypto 本体と、Hash が使う stream 一式を読み込みます。Linux の Node 22.19.0 では、JavaScript の SHA-256 に置き換えると、セッション開始の p50 が 59.4ms から 47.3ms、レビュー開始が 62.5ms から 48.5ms になりました（各30回、交互）。フック1回の CPU 時間が減ると、同時に起動する他のテストとの取り合いも減ります。

この SHA-256 は、署名・鍵・秘密情報を扱いません。公開データから、イベントの識別子と改ざん検出用の指紋を作るためだけに使います。定数時間性は必要ありません。値は `node:crypto` と完全に一致し、既存の golden のイベント ID も変わりません。`node:crypto` へ戻す場合は、clock.mjs の関数を1つ差し替えるだけです。
