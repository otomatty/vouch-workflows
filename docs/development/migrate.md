# v2 record の移行（/vouch migrate）

決定記録 §16・§18（Q1 の台帳と `legacy.<NAME>`）と [レジストリ契約](contracts.md) の「移行と fixture」を正典とする。元資料（`docs/spec/`、`docs/aidlc-v2-reference/`）と既存 fixture / golden は変更しない。

## 分担

移行は Skill（Claude は `/vouch migrate`、Codex は `$vouch migrate`）で進める。機械的な処理はコマンド `vouch-migrate.mjs`、判断はモデル、承認は人が行う。

| 担当 | 行うこと | 行わないこと |
| --- | --- | --- |
| コマンド `plan` | 移行元の全ファイルの列挙・digest・行き先、状態チェックボックスの読み取り、監査の変換の試算、衝突・欠損の検出、成果物の有無の観測 | 書き込み |
| コマンド `apply` | 衝突・欠損がない時だけ、原本の archive へのバイト単位の複製、監査の変換と追記、移行レポート（`migration.md`）の生成、複製と原本の再照合 | 成果物の本文、決定の抽出、規約の統合、codekb の索引、承認 |
| モデル（Skill） | 全件表に従い intent.md / design.md / build-log.md / review.md / decisions.md / rules.md / knowledge を書く | 承認・確認点・回答の記録、`status: approved` への変更、監査・archive の編集 |
| 人 | 移行レポートと成果物を読み、`vouch migrate approve <sha256>` を入力する | — |
| フック（UserPromptSubmit） | 人の `vouch migrate approve` を検査して `migration.completed` を記録する | 移行の実行、Intent の承認 |

## 移行元と archive

移行元は `aidlc/spaces/<space>/intents/<YYMMDD>-<label>/` の record（`migration.json` の `source.record`）と、同じ space の `codekb/`・`memory/` である。コマンドは `plan <space> <YYMMDD-label> [<intent>]`（apply も同じ）で、パスではなく語で受け取る。書き込みガードは登録したコマンドに英数字と `-` の語だけを許すため（[再開・ask・report](resume.md)）、パスを渡す形にはしない。`_` を含む space・record 名はガードを通らないので、人が端末で実行する。Intent 名は既定で record のディレクトリ名で、3語目で別名を指定できる。名前は Vouch の Intent 名の規則（`audit.mjs` の `intentHome`）に従う。

全ファイルを `vouch/archive/aidlc-v2/<プロジェクト root からの元のパス>` へバイト単位で複製する。複製先が既に同じバイトなら書かず、異なれば衝突として何も書かない。リンク・通常ファイル以外・境界外は欠損として扱い、移行しない。原本は読むだけで、`apply` の前後で全ファイルの digest が変わらないことと、archive が原本と一致することを検査する。

## 状態チェックボックス → 4ステージ

`aidlc-state.md` の `## Stage Progress` にある `- [<印>] <stage> — ...` を読む。`Per unit: <名前>` の見出しは Unit として扱い、`[unit-name]` は名前のない Unit とする。印は `checkboxes`（`x` 完了、`-` / `?` / `R` 進行中、`S` スキップ、空白 未着手）、v2 の33ステージは `stages` で Vouch の4ステージか null（対応なし）に分類する。

| v2 のステージ | Vouch |
| --- | --- |
| ideation の7段、requirements-analysis、user-stories、units-generation、delivery-planning | intent |
| refined-mockups、domain-design、contract-design、construction の設計4段 | design |
| code-generation、build-and-test、ci-pipeline | build |
| initialization の3段、reverse-engineering、practices-discovery、operation の7段 | なし |

Vouch のステージごとに、所属する v2 ステージの印から観測を1つ求める。全て完了かスキップで完了が1つ以上なら completed、全てスキップなら skipped、全て未着手なら pending、それ以外は active、所属がなければ absent。verify に対応する v2 ステージはない。観測は移行レポート §2 に記し、成果物の status には使わない。intent.md / design.md は進捗にかかわらず `status: draft` で書く。v2 の `[x]`・`GATE_APPROVED` から Vouch の承認・確認点を作らない。

チェックボックスが1つもない、未知のステージ名・印、厳密な形式に合わないチェックボックス状の行（`- [xx] …`、`* [x] …` など）、`aidlc-state.md` の欠損は MIGRATE-STATE として `apply` を拒否する。読めた行だけで進捗を作らない。

## 元ファイル → 行き先

`record` と `space` の規則を順に照合し、該当した規則の行き先をすべて合わせる（`final` の規則で打ち切る）。`contains` は本文の行に対する条件で、code-generation の `## Review` 付録だけを review.md へ送る。`affirmed` の規則は affirm の証跡（state の `Practices Affirmed Timestamp` か監査の `PRACTICES_AFFIRMED`）がある時だけ行き先を持つ。行き先がない場合は理由（`note`、`unaffirmed`、`unmatched`）とともに移行レポート §4 に載せる。

主な行き先は決定記録 §16 の表に従う。ideation → intent.md#analysis と knowledge/background、requirements / user-stories → intent.md#acceptance、domain / units / delivery → design.md と intent.md#plan、contract → design.md#contract と knowledge/design、construction の設計 → design.md#units（infra は knowledge/infra にも）、code-generation → build-log.md、build-and-test / ci-pipeline → build-log.md#verification、`*-questions.md` と decision-log → decisions.md、practices-discovery と affirm された team / project → vouch/rules.md、codekb/&lt;repo&gt; → knowledge/codekb/&lt;repo&gt;。operation、初期化・検証、ステージの日誌、一時ファイル、v2 の archive、affirm されていない org / phases の既定は archive のみに残す。

## 監査

`audit/*.md` のシャードを `---` の行で区切り、各ブロックを1件の記録にする。区切りの前のファイル見出しだけのブロックは記録しない。時刻はブロックの最初の `**Timestamp**:`、種別は `**Event**:`、その他の `**名前**: 値` をフィールドとして読む。全シャードを時刻・パス・順で並べてから変換する。

- 移行した全記録に `original_type`（v2 名、Event がなければ `UNTYPED`）、`raw`（ブロックの原文）、`source_path`（`元のパス#L行`）を付ける。これらと `estimated` を持てるのは変換先の3種（stage.started / stage.completed / learn.recorded）と `legacy.*` だけで、`estimated` や `source_path` があれば出所の3項目をそろえることを、その種別のスキーマで要求する。`actor` は記録したフック（`hook`）とし、元の主体は raw に残す。ID は Intent・出所・原文から決め、再実行で同じ記録になる。
- 時刻が欠損・不正なら同じシャードの直前（なければ直後）の時刻を使い `estimated: true` を付ける。シャードに有効な時刻が1つもない、または記録が1つもない（見出しだけ）時は MIGRATE-AUDIT として `apply` を拒否する。
- 変換は `audit-migration.json` の候補のうち、必須値を復元できる3種に限る。STAGE_STARTED は Vouch ステージごとに最初の1件を `stage.started` に、STAGE_COMPLETED は観測が completed のステージで最後の1件を、変換済みの開始を親として `stage.completed`（所要時間は時刻差で `estimated: true`）にする。build は loop_iterations / tests を復元できないため変換しない。RULE_LEARNED は `learn.recorded`（rules_added 1）にする。
- それ以外は `legacy.<NAME>` に原文を保存する。intent / unit の risk、session、Q-n と選択肢、gate のソース、review の harness、sensor の検査種別、codekb の更新の範囲など、必須の意味や値を復元できないためである。`GATE_APPROVED` から Intent 承認を推測しない。
- `estimated` の記録は report で実測から除き、件数だけを示す。

人の決定の候補（`audit.decisions` の種別）は移行レポート §6 に監査 ID と出所を並べる。モデルは原文のまま decisions.md の「判断と採用しなかった案」へ抽出し、Vouch の承認・確認点・回答としては記録しない。

## 規約・codekb

規約は §7 に affirm の証跡と各ファイルの扱いを示す。証跡がある時だけ team.md / project.md をモデルが vouch/rules.md に統合し、affirm されていない org / phases の既定は落とす。

codekb は §8 に repo ごとのファイル数と `reverse-engineering-timestamp.md` の `Date:` / `Commit:` を示す。完全な SHA でない commit は世代を検証できない。explorer が knowledge/codekb/&lt;repo&gt;/ と索引を書き、移行の直後に `vouch knowledge check` を実行する。古い・不明な世代は既存の鮮度検査の手順で再走査する。

## 移行レポートと承認

`apply` は Intent のフォルダに `migration.md`（`rules.md` の language、なければ既定 ja）を書く。frontmatter は `status: draft`、`source`、`intent`、`files`、`blocks`（監査ブロック数）。§1 結論、§2 進捗、§3 全件表、§4 行き先のないファイル、§5 監査の変換、§6 人の決定の候補、§7 規約、§8 codekb、§9 推測しなかったことを持つ。生成は決定的で、同じ移行元なら同じバイトになる。

人は `vouch migrate approve <migration.md の sha256>` を入力する。UserPromptSubmit のフックは、設定した Intent（`VOUCH_INTENT`）の migration.md が `status: draft` でその Intent を名指し、digest が一致し、プロンプトの識別子があり、apply の結果が残っている時だけ `migration.completed`（actor human、files_migrated、revision、submission）を記録し、モデルへは送らない。apply の結果とは、§3 の全件表の行数が `files` と一致して各行の archive のコピーが通常ファイルとして存在すること、監査に `source` 由来の移行記録が `blocks` と同数あることである（VOUCH-MIGRATE-UNAPPLIED）。手で書いた移行レポートはこれを満たさない。digest が違う・レポートがない・形式が違う時も理由を返して記録しない。移行の承認は Intent の承認ではない。

## 再実行・部分失敗・衝突

- 書き込みは「なければ作る、同じなら何もしない」に限る。`apply` は全ての書き込み先を先に検査し、1つでも異なる内容があれば MIGRATE-TARGET で何も書かない。
- archive → 監査 → 移行レポートの順に書く。途中で失敗しても、再実行は書けた分を同一として飛ばし、残りを書く。監査の追記は1回の原子的な置換である。
- Intent のフォルダに移行レポートがないのに成果物（この record が行き先に含まないものも含め、project-documents.json の全成果物と decisions.md）がある、または監査にこの移行が作らない記録がある場合は、別の Intent と衝突しているとして拒否する。移行レポートが一致していれば、承認やその後の作業の記録があっても再実行できる。
- 結果の JSON は全ファイル数、archive 済み・同一、監査ブロック・変換・legacy・推定の数を返す。数の合計は元ファイル数・ブロック数と一致する。

## 検査の対応

コマンドの checks は MIGRATE-ARGS（操作と語の形）、MIGRATE-SOURCE（record の有無）、MIGRATE-FILES（リンク・通常ファイル以外・読めないファイル）、MIGRATE-STATE（チェックボックス）、MIGRATE-AUDIT（UTF-8 と時刻）、MIGRATE-TARGET（衝突）、apply の時だけ MIGRATE-WRITE と MIGRATE-VERIFY を返す。不合格の check があれば終了2で、apply は書き込まない。

ファイルの読み書きは fs.mjs の FileStore を通す。今回、正確なバイトの読み取り（readBytes）、同じバイトなら書かず異なれば FS-CONFLICT とする作成（createBytes、既存の更新ロック・fsync・原子的な rename を共用）、リンクを辿らない直下の一覧（list）を追加した。fs.mjs の行数上限を保つため、パスの分類（locate）を locate.mjs に分け、その検査は locate.test.mjs に移した。

## 実装と検証記録

2026-10-01、契約 → 失敗する先行テスト → 実装の順でコミットした。状態の読み取り（v2-state.mjs）、監査の分割と変換（v2-audit.mjs）、行き先の規則（migrate-plan.mjs）、移行レポート（migrate-brief.mjs）、ファイルの収集・衝突・照合（migrate-files.mjs）、コマンドの組み立て（migrate.mjs）、人の承認（migrate-approve.mjs）を分けた。

入力の区別は次のとおり。15種の状態 fixture、監査サンプル、inception / construction / re の成果物、memory の3層は `docs/aidlc-v2-reference/` の原本をそのまま読む。2つ目の監査シャード、`## Review` 付録、質問ファイル、日誌、operation、バイナリ、未対応のファイルは手製の入力である。各状態の進捗の期待値は fixture のチェックボックスから手で求めた。UserPromptSubmit の承認は Claude Code 2.1.283 / Codex 0.153.4 の採取済み入力から作った synthetic 入力で検証した。実際の v2 利用者の record の移行、モデルによる成果物・決定・規約の書き換えの評価、人の実承認は未実施である。

Linux / Node.js 22.22.0 で `npm run check` が69.3秒（予算90秒）で成功した。content・registry・packaging 182件、unit 337件、scenario 27件（2相）、hooks 103件と負荷測定16件の計665件、配布272ファイルの生成と一致を確認した。lib のカバレッジは行99.98% / 分岐97.44% / 関数100%、フック入口は100%。全件の apply は1回あたり約90ms（Linux、archive の fsync を含む）で、15種の状態は状態ファイルと監査サンプルだけの record で apply し、全成果物を含む record は代表の状態で検証した。Windows / macOS の結果は CI で確認する。

## 残る制限

- archive は書き込みガードの保護対象ではない。ツールからの `vouch/archive/aidlc-v2/` への書き込みを遮る検査は未実装で、再実行の衝突検出と移行レポートの digest で変更を検出する。
- space の `knowledge/`（チーム知識）とフレームワーク側の memory は移行元に含めない。space の `memory/` にある org.md / phases は affirm されていない既定として落とす。
- `_` を含む space・record 名は書き込みガードが登録コマンドの引数として通さないため、人が端末で実行する。
- 承認のフックは archive のコピーの存在と移行記録の件数を検査するが、コピーのバイトや元ファイルとの一致は再検査しない（毎回の承認で全ファイルを読まないため）。archive は書き込みガードの対象外なので、意図的に作ったコピーは区別できない。バイトの一致は apply の MIGRATE-VERIFY と再実行の衝突検出が担う。
- 監査の変換は3種に限る。sensor の結果、codekb の更新、review の要求なども legacy として原文で残り、Vouch の計測には数えない。

### PR #34 のレビュー修正

2026-10-01、レビューの指摘4件を再現するテストを追加してから修正した。承認は apply の結果（archive のコピーと移行記録の件数）を要求し、手で書いた移行レポートでは記録しない。所有権の検査は record が行き先に含まない成果物も対象にする。形式の合わないチェックボックス状の行と記録のない監査シャードは問題として拒否する。移行レポートの codekb の節は、行き先の規則と同じ正規表現で repo を判定する。移行レポートの frontmatter に `blocks` を加えたため、この PR で追加した golden を更新した。

同日の CI（run 36842590907）では、Windows / Node 24 の既存の承認記録の負荷測定が p95 200.2ms で200ms予算をわずかに超えた。前の head では合格していたが、この PR がすべての UserPromptSubmit で移行承認のモジュールと migration.json を読み込むようにしたため、起動の余裕を削っていた。承認コマンドの接頭辞と digest の形式を他の人の入力コマンドと同じ intent-review.json に移し、`migrate-approve.mjs` は接頭辞の判定だけを行い、一致した時に記録部（`migrate-approval.mjs`）と migration.json を動的に読み込むよう分けた。Linux での追加の読み込み時間は約1.2msから約0.4msになった。時間予算と測定は変更していない。

同じ CI の別の実行（run 36842592698）では、Windows / Node 24 の Stop 記録の負荷測定が p95 215.8ms だった。Linux で基準コミットと交互に測ると、監査スキーマに加えた出所の項目と条件が原因だった。条件を全種別（後に根）に置くと、移行と無関係な記録の検査にも評価が加わり、Stop 記録の中央値が約7ms増えた。出所の項目と条件を移行記録になり得る4種別だけに置くと、交互測定（各100回）で基準との差は中央値3.6ms・p95 2.5msになった。スキーマは80KBから86KBになる（修正前は113KB）。
