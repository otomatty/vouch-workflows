# lockfile の生成と CI の依存導入

## 契約

DEP-2 に従い、devDependencies の完全固定、`package-lock.json` のコミット、CI の `npm ci` を維持します。`npm ci` から `npm install` への置換、doctor・check の省略、devDependencies 8件の版の変更、依存全体の更新はしません。実行時依存ゼロ（DEP-1 / HOOK-1）も維持します。

lockfile の各項目が必要とする依存は、Node.js の node_modules 探索順で lockfile 内の項目に解決できなければなりません。対象は dependencies・optionalDependencies・devDependencies と、peerDependenciesMeta で任意とされていない peerDependencies です。ルートからこれらの依存をたどって到達できない項目も持ちません。DEP-2 の構造テストがこの2点を npm の版によらず静的に検査します。版範囲の充足は検査せず、`npm ci` の同期判定の代わりにはしません。

lockfile を書き換える操作（`npm install`、`npm uninstall`、`npm update`、`--package-lock-only` を含む）は npm 10.9.x または 11.6.3 以上で行います。npm 11.5.0〜11.6.2 は使いません。`packageManager` はこの範囲外の npm 11.19.0 を宣言し、構造テストで範囲内の版を拒否します。`npm ci` だけを行う環境の npm は制限しません。

## CI の条件

bddb412 の初回 CI（run 36354893596）の4ジョブです。各ジョブは新しい runner で、setup-node の npm キャッシュは見つからず（`npm cache is not found`）、node_modules もない状態から `npm ci` を実行しました。`.npmrc` は `engine-strict=true`、`save-exact=true`、`fund=false` です。

| ジョブ | Node.js | npm | 結果 |
| --- | --- | --- | --- |
| Node 22.19.0 / ubuntu-latest | 22.19.0 | 10.9.3 | `npm ci` が EUSAGE |
| Node 22.19.0 / windows-latest | 22.19.0 | 10.9.3 | `npm ci` が EUSAGE |
| Node 24.x / ubuntu-latest | 24.21.0 | 11.19.0 | `npm ci` が EUSAGE |
| Node 24.x / windows-latest | 24.21.0 | 11.19.0 | `npm ci` が EUSAGE |

4ジョブとも `Missing: @emnapi/core@1.11.3 from lock file` と `Missing: @emnapi/runtime@1.11.3 from lock file` を出し、パッケージの取得前に終了しました。doctor と check は実行されていません。

## 再現

Linux x64 のコンテナで bddb412 を新しいディレクトリへ取り出し、nodejs.org の公式バイナリの Node.js 22.19.0（npm 10.9.3）と 24.21.0（npm 11.19.0）、空の npm キャッシュで `npm ci --ignore-scripts` を実行しました。どちらも CI と同じ2行の Missing で EUSAGE になりました。Windows の runner での再現はしていません。

## 原因

knip 6.38.0 が依存する oxc-resolver 11.24.2 は、optionalDependencies に `@oxc-resolver/binding-wasm32-wasi` 11.24.2（cpu: wasm32）を持ちます。この binding は `@emnapi/core`・`@emnapi/runtime` の 1.11.2 を完全固定で、`@napi-rs/wasm-runtime` を ^1.1.6 で依存します。lockfile では 1.11.2 の2つが binding の下の node_modules に入れ子で置かれ、`@napi-rs/wasm-runtime` 1.2.4 は最上位に巻き上げられています。

`@napi-rs/wasm-runtime` は `@emnapi/core`・`@emnapi/runtime`（^1.7.1 || ^2.0.0-alpha.4）を、任意指定のない peerDependencies に持ちます。最上位の `node_modules/@napi-rs/wasm-runtime` からは binding の下の入れ子が見えないため、最上位に両者が必要です。コミットされた lockfile にはこの2項目がありませんでした。npm 10.9.3 / 11.19.0 は不足分を最新の 1.11.3 で補った木と lockfile を比べ、不一致と判定しました。

lockfile には、どの項目からも依存されない `node_modules/@emnapi/wasi-threads` 1.2.3 も残っていました。1.2.3 は `@emnapi/core` 1.11.3 の依存です。最上位の 1.11.3 の2項目が一度解決された後、依存先だけを残して取り除かれた形です。

npm の版ごとに、修正後の lockfile を入力にした `npm install --package-lock-only` の結果と、元の lockfile での `npm ci` の判定を比較しました。

| npm | lockfile の再生成 | 元の lockfile での `npm ci` |
| --- | --- | --- |
| 10.9.3、10.9.4、10.9.9 | 最上位の2項目を保持 | 拒否 |
| 11.0.0、11.2.0、11.3.0、11.4.0、11.4.2 | 最上位の2項目を保持 | 拒否 |
| 11.5.0、11.5.1、11.5.2、11.6.0、11.6.1、11.6.2 | 最上位の2項目を削除 | 受理 |
| 11.6.3、11.6.4、11.7.0、11.8.0、11.9.0、11.12.1、11.19.0、11.20.0 | 最上位の2項目を保持 | 拒否 |

npm 11.6.2 の出力は、コミットされた lockfile とバイト単位で一致しました。npm 11.6.2 はローカルの基準である Node.js 24.13.0 の同梱版で、`packageManager` の宣言とも同じです。この版は元の lockfile を受理するため、ローカルの既存 node_modules での check は成功し、別の npm を使う CI で初めて不一致が表面化しました。

npm 11.6.3 の変更履歴には依存フラグ計算の修正（npm/cli#8645）がありますが、どの変更で挙動が変わったかは特定していません。版の境界は上表の測定によるものです。測定は Linux x64 で行い、npm 11.6.2 は Node.js 22.19.0 と 24.21.0 のどちらで動かしても同じ結果でした。

## 生成方法

lockfile は削除せず、既存の lockfile を入力にして書き換えます。npm 11.5.0〜11.6.2 の環境（Node.js 24.13.0 の同梱 npm を含む）では、npm 11.19.0 を一時的に取得して実行します。

```sh
npm exec --yes --package=npm@11.19.0 --call "npm install --package-lock-only --ignore-scripts --no-audit"
```

Linux で npm 11.6.2 と 10.9.3 からこのコマンドを実行し、どちらも npm 11.19.0 の直接実行と同じ lockfile になることを確認しました。Windows で `scripts/npm.ps1` を使う場合は、先頭の `npm` を `.\scripts\npm.ps1` に置き換えます。`--` ではなく `--call` で渡すのは、PowerShell のスクリプト呼び出しで `--` が引数として渡らない場合を避けるためです。Windows でのこのコマンドの実行は未確認です。

devDependencies を追加・変更する場合も、同じ `--call` に `npm install --save-dev <名前>@<版>` を渡します。`.npmrc` の `save-exact=true` で完全固定になります。書き換えた後は差分が意図した項目だけであることを確認し、`npm run check` で DEP-2 の構造テストを通します。

## テストと残件

DEP-2 の構造テストに、lockfile の解決・到達の検査と `packageManager` の版の検査を追加します。元の lockfile では `node_modules/@napi-rs/wasm-runtime` から `@emnapi/core`・`@emnapi/runtime` が解決できず、`node_modules/@emnapi/wasi-threads` が到達不能になることを、修正前に失敗として確認します。

CI の4ジョブで `npm ci` が成功し、doctor と check まで到達することを修正後の push で確認します。check の性能予算の未達はこの修正の対象外とし、結果を別の Issue に記録します。lockfile の修正のために性能検査を省略・緩和しません。

## 修正と先行テスト

契約を2122616、先行テストを6bcdfffでコミットしました。先行テストは元の lockfile で2件とも失敗しました。依存の解決は `node_modules/@napi-rs/wasm-runtime -> @emnapi/core` と `-> @emnapi/runtime` の2件を報告し、`packageManager` の npm 11.6.2 は範囲内として拒否しました。`t.assert` は最初の失敗で止まるため、到達不能の検査は修正後の lockfile に孤立項目を1件加えた変種で失敗を確認しました。peer を任意指定に変えた変種と、依存を入れ子に置いた変種が失敗しないことも確認しています。変種はコミットしていません。

32c1824で、生成方法のコマンドを Node.js 22.19.0 の npm 10.9.3 から実行して lockfile を再生成し、`packageManager` を npm@11.19.0 に変更しました。lockfile の差分は次の3点だけです。既存項目の version・resolved・integrity は変わらず、devDependencies 8件と実行時依存ゼロも維持しています。

- 最上位に `@emnapi/core`・`@emnapi/runtime` 1.11.3 を追加（dev・optional・peer）
- `@emnapi/wasi-threads` に peer フラグを付与
- `@babel/core`、`@types/node`、`acorn`、`browserslist`、`markdownlint-cli2` の peer フラグを削除

追加した2項目は cpu: wasm32 の任意依存で、Linux x64 では node_modules に展開されないことを確認しました。再生成した lockfile に npm 10.9.3 / 11.19.0 で `npm install --package-lock-only` を再実行しても差分は出ません。npm 11.6.2 の `npm ci` も修正後の lockfile を受理し、lockfile を書き換えません。Node.js 24.13.0 の環境でも導入と check は続けられますが、その同梱 npm で lockfile を書き換えると同じ欠落が再発し、DEP-2 の構造テストが失敗します。

## ローカルの検証

Linux x64 のコンテナで 32c1824 を新しく取り出し、空の npm キャッシュで実行しました。

| Node.js / npm | `npm ci` | doctor | check | 記録 p95（レビュー開始 / 承認 / セッション開始） |
| --- | --- | --- | --- | --- |
| 22.19.0 / 10.9.3 | 315件導入 | 全項目 OK | 214件成功・22.4秒 | 115.7 / 110.5 / 91.0ms |
| 24.21.0 / 11.19.0 | 315件導入 | 全項目 OK | 214件成功・19.9秒 | 106.4 / 92.1 / 83.7ms |

内訳は content 30件（今回2件追加）、registry 42件、packaging 24件、scenario 10件、unit 71件、hooks 37件です。このコンテナは bddb412 時点の Linux 検証環境とは別の環境で、性能の改善を示す結果ではありません。

## CI の結果

32c1824 の CI（run 36358481294）では、4ジョブとも `npm ci` と doctor が成功し、check まで到達しました。Lint・型検査も4ジョブとも成功しています。

| ジョブ | Node.js / npm | `npm ci` | doctor | check |
| --- | --- | --- | --- | --- |
| Node 22.19.0 / ubuntu-latest | 22.19.0 / 10.9.3 | 315件導入 | 全項目 OK | 214件成功・13.6秒 |
| Node 24.x / ubuntu-latest | 24.21.0 / 11.19.0 | 315件導入 | 全項目 OK | 214件成功・21.2秒 |
| Node 22.19.0 / windows-latest | 22.19.0 / 10.9.3 | 312件導入 | 全項目 OK | packaging のファイル単位の5秒超過で失敗 |
| Node 24.x / windows-latest | 24.21.0 / 11.19.0 | 312件導入 | 全項目 OK | scenario 10件中4件が FS-ESCAPE で失敗 |

導入件数の差は、プラットフォーム別の任意依存の差です。Ubuntu の記録 p95 は、Node 22.19.0 でレビュー開始67.1ms・承認55.4ms・セッション開始43.5ms、Node 24.21.0 で112.2ms・100.5ms・86.9msでした。共通 lib のカバレッジは行99.89% / 分岐98.20% / 関数100%、フックは100% / 100% / 100%です。

Windows の2ジョブの失敗は、lockfile とは別の既存の問題です。`npm ci` の置換や検査の省略はしていません。

- Node 22.19.0：`tests/packaging/native-environment.test.mjs` がファイル全体で5000msを超え、キャンセルされました。PowerShell を起動する2件のうち1件目は2916msで成功し、2件目の結果は出力されていません。Node 22 の `--test-timeout` は分離したテストファイル全体に適用されます。scenario 以降の階層と package / package:check は実行されていません。
- Node 24.x：packaging は成功しましたが、PowerShell を起動する2件は2942ms・4061msでした。scenario の配布先記録2件とレビュー記録2件が `HOOK-2: FS-ESCAPE: outside project root` で失敗し、unit・hooks の階層と package / package:check は実行されていません。

FS-ESCAPE の原因は推定です。`createFileStore` は root を `realpathSync.native` で正規化しますが、`run()` が包含を検査する入力の `cwd` は正規化しません。同じ実体を指す別名のパスを root と `cwd` の両方に渡すと、同じディレクトリでも root の外と判定されます。Linux で記号リンクの別名を両方に渡し、この挙動を FileStore 単体で再現しました。Windows の runner では一時ディレクトリが 8.3 形式の短い名前を含む場合に同じ差が生じると推定していますが、CI のログにパスは出力されておらず、runner 上では確認していません。記号リンクの一時ディレクトリで scenario 全体を動かす方法は、配布生成が先に PACKAGE-LINK で拒否するため再現になりませんでした。

## 残件

Windows の記録性能とテスト時間の予算は [Issue #2](https://github.com/otomatty/vouch-workflows/issues/2) で扱います。今回の Windows ジョブは hooks の階層に到達しておらず、Windows の CI での記録 p95 はまだ得られていません。FS-ESCAPE はパスの包含判定の不具合として、性能とは別に [Issue #18](https://github.com/otomatty/vouch-workflows/issues/18) で扱います。原因は runner の一時ディレクトリの 8.3 短縮名と確認しました。修正と CI の結果は [root の別名と包含判定](root-alias.md)に記録しています。lockfile の修正はこれらを解消しません。
