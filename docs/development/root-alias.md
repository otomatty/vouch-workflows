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

先行テストは修正前にすべての OS で失敗し、Windows の CI では既存の scenario 4件と合わせて失敗することを確認します。packaging のテスト時間超過と記録 p95 は [Issue #2](https://github.com/otomatty/vouch-workflows/issues/2) の結果として区別し、この変更の合否に含めません。
