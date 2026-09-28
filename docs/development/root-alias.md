# プロジェクト root の別名と包含判定

## 現状

Windows / Node 24.21.0 の CI（run 36358481294、job 108730813530）で、配布先の記録を検査する scenario 4件が `HOOK-2: FS-ESCAPE: outside project root` で失敗しました。Ubuntu の2ジョブでは同じ4件が成功しています。

`createFileStore(root)` は root を `realpathSync.native` で実体のパス（以下 base）に正規化します。`run()` が包含を検査する入力の `cwd` と `tool_input.file_path` は、base を起点に字句上だけで解決していました。そのため、同じディレクトリを指す別の綴りを root と `cwd` に渡すと、root の外と判定されます。Linux の記号リンクで次の結果を再現しました（[Issue #18](https://github.com/otomatty/vouch-workflows/issues/18)）。

| root | cwd | 変更前の結果 |
| --- | --- | --- |
| 実体 | 実体 | 成功 |
| 別名 | 別名 | `FS-ESCAPE` |
| 別名 | 実体 | 成功 |
| 実体 | 別名 | `FS-ESCAPE` |

一時ディレクトリ（`TMPDIR`）を記号リンク経由にした Linux で、hooks 階層の製品フックの子プロセステスト3ファイル24件を実行すると、22件が同じ `FS-ESCAPE` で失敗しました。runner の一時ディレクトリが 8.3 形式の短縮名を含み、`realpathSync.native` が長い名前に展開していると推定しています。runner での確認は後述の記録で行います。

## 契約

root の実体と同じディレクトリを指す絶対パスは、綴りが違っても root として扱います。対象は Windows の 8.3 短縮名・junction・subst ドライブ、POSIX の記号リンク、root の祖先に対する別名です。

`resolvePath(path)` は次の順で判定します。

1. 空文字、NUL、ドライブ接頭辞以外のコロン（ADS を含む）は、従来どおり最初に `FS-PATH` で拒否します。
2. base を起点に字句上で解決し、base の配下なら従来と同じ要素ごとの検査に進みます。この経路では realpath を追加で呼びません。
3. 字句上 base の外なら、解決した絶対パスの祖先を浅い順に `realpath` します。実体が base と一致する最も浅い祖先を root の別名とし、その下の残りの要素を base に連結します。
4. 残りの要素は、2 と同じく base から1つずつ `lstat` で検査します。記号リンク・junction・複数リンクのファイルは `FS-LINK`、特殊ファイルは `FS-TYPE`、末尾のドット・空白と予約名は `FS-PATH` です。
5. 一致する祖先がない場合、または存在しない祖先（`ENOENT`・`ENOTDIR`）に達した場合は `FS-ESCAPE` です。その他の realpath の失敗は、そのまま拒否の原因として返します。

返り値は base の配下の実体側のパスです。読み書きとロックは入力の綴りではなく、このパスで行います。一致する祖先の実体が base と同じなら、祖先までの綴り自体は操作に使いません。そのため、要素名の検査は祖先より下の、root の中の要素に適用します。

最も浅い祖先を選ぶのは、root の中のリンクを別名として扱わないためです。root の中に root 自身を指すリンク `self` があっても、`<別名>/self/file` は祖先 `<別名>` で一致し、残りの `self` を `FS-LINK` で拒否します。root の外を指す別名は `FS-ESCAPE` のままです。

比較は実行環境の `path.relative` で行い、Windows では大文字小文字を区別しません。realpath の結果とファイルの属性はキャッシュしません。

## 弱めないこと

root の外を指すパス（`FS-ESCAPE`）、root の中のリンクを経由する経路（`FS-LINK`）、予約名・ADS（`FS-PATH`）の拒否は変えません。`..` は従来どおり字句上で先に解決します。検査と操作の間に別プロセスがディレクトリを差し替える攻撃を完全に防ぐものではない点も、[共通ランタイム](runtime.md)の記載から変わりません。

テストの削除・スキップや、テスト側の一時ディレクトリを正規化するだけの変更で CI を通しません。既存の scenario、fixture、golden は変更しません。

## 検証方法

- unit：FileStore に記号リンク（Windows は junction）の別名を作り、root と入力の4通りと `file_path` 相当の書き込みで base の配下に解決することを検査します。root の外への別名、別名経由の root 内のリンク・root 自身へのリンク・複数リンク・予約名・ADS・`..` による逸脱、realpath の失敗の伝播も検査します。
- unit：`run()` に別名の root を設定し、別名の `cwd`・`tool_input.file_path` で main が呼ばれることを検査します。
- scenario：配布した Claude の SessionStart を、別名の `CLAUDE_PROJECT_DIR` と `cwd`、実体の root と別名の `cwd` で2回実行し、golden と一致する1件の記録になることを検査します。このテストは一時ディレクトリ・root・別名・`cwd` と、それぞれの `realpathSync.native` の結果を `t.diagnostic` で出力し、runner 上の綴りを記録します。

既存の `tests/unit/lib/fs-driver.test.mjs` の2件は、`resolvePath` の返り値とロック内の一時ファイルのパスを sandbox の綴り（`box.path()`）と比べていました。返り値は変更前から base を起点とする実体側のパスです。一時ディレクトリが別名を含む環境では、今回の修正と関係なく失敗します（`TMPDIR` を記号リンク経由にした Linux で確認）。入力は sandbox の綴りのまま残し、期待値だけを base 起点に改めます。

`npm test` は、失敗した階層の後も残りの階層を実行し、最後に失敗として終了します。Windows / Node 22.19.0 の CI では packaging の時間超過（#2）で scenario 以降が実行されていなかったため、この Issue の scenario の結果を #2 と分けて得るための変更です。

先行テストは修正前にすべての OS で失敗し、Windows の CI では既存の scenario 4件と合わせて失敗することを確認します。packaging のテスト時間超過と記録 p95 は #2 の結果として区別し、この変更の合否に含めません。

## 実装と先行テスト

契約を f915cb9、`npm test` の全階層実行を 6fbb3b0、先行テストを 75c62dd、修正を 356f38a、ミューテーションで見つけた検査の追加を 3297fa4 でコミットしました。75c62dd の時点で、Linux x64 / Node 22.22.2 の新しいテスト5件（unit 4件・scenario 1件）が `FS-ESCAPE` で失敗することを確認しました。

`TMPDIR` を記号リンク経由にした Linux でも、runner の条件を再現しました。配布生成の `PACKAGE-LINK` だけを手元で一時的に外し（コミットしていません）、scenario を実行しました。修正前は CI の Windows と同じ既存4件と新しい1件が失敗し、修正後は11件すべて成功しました。unit・hooks は `PACKAGE-LINK` で止まる doctor の2件を除いて成功します。この2件は配布生成が記号リンクを拒否する仕様どおりの結果で、8.3 短縮名はリンクではないため Windows では起きません。

## runner での記録

修正前の 75c62dd の CI（run 36376711145）で、scenario の診断出力は Windows の2ジョブとも次の綴りを記録しました。Node 22.19.0 と 24.21.0 で同じです。

| 項目 | 値 |
| --- | --- |
| `os.tmpdir()` | `C:\Users\RUNNER~1\AppData\Local\Temp` |
| `realpathSync.native(os.tmpdir())` | `C:\Users\runneradmin\AppData\Local\Temp` |
| root（sandbox の綴り） | `C:\Users\RUNNER~1\AppData\Local\Temp\vouch-runtime-…\日本語 project $ apostrophe'` |
| root の `realpathSync.native` | `C:\Users\runneradmin\AppData\Local\Temp\vouch-runtime-…\日本語 project $ apostrophe'` |

scenario の既存4件は root と `cwd` をどちらも `RUNNER~1` の綴りで渡しています。FileStore の base は `runneradmin` に展開されるため、`cwd` は字句上 base の外になり `FS-ESCAPE` になります。これで原因を確定しました。Ubuntu の2ジョブでは `/tmp` のまま変わりません。

修正前の Windows では、全階層を実行した結果、次の失敗も観測しました。

- unit の既存1件：`io defaults use trusted environment, stdin, stderr and process exit status`（sandbox を root と `cwd` に渡すため）
- hooks 37件中29件：記録の子プロセスが `HOOK-2: FS-ESCAPE` で終わり、監査ログが作られないことによる失敗

Windows / Node 22.19.0 でも同じ失敗が起きることは、これで初めて確認できました。

## CI の結果

| ジョブ | 修正前 75c62dd（run 36376711145） | 修正後 356f38a（run 36376923716） |
| --- | --- | --- |
| Node 22.19.0 / ubuntu-latest | scenario 1件・unit 4件が失敗（新しいテスト） | scenario 11件・unit 75件が成功。hooks はレビュー開始 p95 252.4ms で1件失敗 |
| Node 24.x / ubuntu-latest | scenario 1件・unit 4件が失敗（新しいテスト） | check 全体が成功（21.8秒、配布 128 ファイルの生成・一致検査を含む） |
| Node 22.19.0 / windows-latest | packaging 1件キャンセル、scenario 5件・unit 5件・hooks 29件が失敗 | scenario 11件・unit 75件が成功。packaging 1件キャンセル、hooks はレビュー開始 p95 241.4ms で1件失敗 |
| Node 24.x / windows-latest | scenario 5件・unit 5件・hooks 29件が失敗 | scenario 11件・unit 75件が成功。hooks はレビュー開始 p95 226.6ms で1件失敗 |

修正後は4ジョブとも scenario と unit が全件成功し、どのログにも `FS-ESCAPE` は出ていません。`fs.mjs` のカバレッジは4ジョブとも行・分岐・関数 100% です。

修正後に残った失敗は、[Issue #2](https://github.com/otomatty/vouch-workflows/issues/2) で扱う時間予算です。

- Windows / Node 22.19.0 の `tests/packaging/native-environment.test.mjs` は、ファイル全体で 5000ms を超えてキャンセルされました。
- 記録 p95（HOOK-13、200ms 未満）は、レビュー開始が Ubuntu Node 22 で 252.4ms、Windows Node 24 で 226.6ms、Windows Node 22 で 241.4ms でした。承認とセッション開始は4ジョブとも予算内です。
- Windows の記録 p95 が CI で得られたのは今回が初めてです。修正前は hooks まで到達しないか、記録が `FS-ESCAPE` で失敗していました。

Ubuntu Node 22 のレビュー開始は、修正前の run では 79.3ms でした。修正後の字句上 root 配下の経路は、realpath などのシステムコールを追加しません。同じ Linux コンテナで、変更前 e508288 と修正後を交互に3回ずつ測りました。レビュー開始 p95 は変更前 91.7 / 114.3 / 93.4ms、修正後 98.1 / 111.5 / 118.2ms で、ばらつきの範囲と区別できませんでした。CI の 252.4ms を今回の変更による悪化とは判断しません。予算の合否は #2 の結果として残し、閾値・試行数・計測方法は変更していません。

## ミューテーション

対象は `fs.mjs` だけです。unit 全体と `tests/hooks/fs-native-path.test.mjs` を `node --test` で直接実行するコマンドを、変更前後で同じに使いました。`npm run test:unit` は、計装したコードでカバレッジ閾値を満たせず初回実行で止まるためです。[性能改善の記録](file-store-performance.md)の測定とはテストの範囲が異なるので、数値は直接比べません。

| 版 | 変異 | 検出 | 生存 | スコア |
| --- | --- | --- | --- | --- |
| 変更前 e508288 | 135 | 122 | 13 | 90.37% |
| 修正 356f38a | 155 | 142（タイムアウト2を含む） | 13 | 91.61% |
| 追加テスト 3297fa4 | 155 | 147（タイムアウト2を含む） | 8 | 94.84% |

修正の時点では、字句上の包含条件に関わる5件が新たに生き残りました。字句上 root 配下のパスでも別名の探索を呼ぶ変異と、`..` を `FS-PATH` として扱う変異です。どちらも拒否・許可の結果は変わらず、契約の「この経路では realpath を追加で呼ばない」「root の親は `FS-ESCAPE`」に反するものです。この2点を検査する unit を追加し、5件とも検出されるようにしました。

最終的な生存8件のうち7件は変更前と同じ変異です。内訳はドライブ接頭辞の正規表現3件、置換文字列2件、空要素の除去1件、UTF-8 指定1件です。新しい1件は、祖先の一覧の末尾に存在しない相対パスを加える変異です。本物の祖先がどれも root と一致しなかった後にしか参照されず、`FS-ESCAPE` で終わる結果は変わりません。等価な変異として残します。

## 残件

- CI では Windows の 8.3 短縮名（runner の一時ディレクトリ）と junction（テストで作成）を検査しています。subst ドライブと Windows の記号リンクは契約の対象ですが、実機では検査していません。
- Claude Code / Codex の CLI を別名のパスで起動した実機の採取はしていません。scenario の入力は版付き fixture を基にした synthetic です。
- 記録 p95 と Windows / Node 22.19.0 の packaging のテスト時間超過は [Issue #2](https://github.com/otomatty/vouch-workflows/issues/2) で扱います。今回の修正で、Windows の CI でも hooks の階層まで結果が得られるようになりました。
