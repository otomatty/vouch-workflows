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

移行元は `aidlc/spaces/<space>/intents/<YYMMDD>-<label>/` の record（`migration.json` の `source.record`）と、同じ space の `codekb/`・`memory/` である。Intent 名は既定で record のディレクトリ名、`plan <record> <intent>` で別名を指定できる。名前は Vouch の Intent 名の規則（`audit.mjs` の `intentHome`）に従う。

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

チェックボックスが1つもない、未知のステージ名・印、`aidlc-state.md` の欠損は MIGRATE-STATE として `apply` を拒否する。

## 元ファイル → 行き先

`record` と `space` の規則を順に照合し、該当した規則の行き先をすべて合わせる（`final` の規則で打ち切る）。`contains` は本文の行に対する条件で、code-generation の `## Review` 付録だけを review.md へ送る。`affirmed` の規則は affirm の証跡（state の `Practices Affirmed Timestamp` か監査の `PRACTICES_AFFIRMED`）がある時だけ行き先を持つ。行き先がない場合は理由（`note`、`unaffirmed`、`unmatched`）とともに移行レポート §4 に載せる。

主な行き先は決定記録 §16 の表に従う。ideation → intent.md#analysis と knowledge/background、requirements / user-stories → intent.md#acceptance、domain / units / delivery → design.md と intent.md#plan、contract → design.md#contract と knowledge/design、construction の設計 → design.md#units（infra は knowledge/infra にも）、code-generation → build-log.md、build-and-test / ci-pipeline → build-log.md#verification、`*-questions.md` と decision-log → decisions.md、practices-discovery と affirm された team / project → vouch/rules.md、codekb/&lt;repo&gt; → knowledge/codekb/&lt;repo&gt;。operation、初期化・検証、ステージの日誌、一時ファイル、v2 の archive、affirm されていない org / phases の既定は archive のみに残す。

## 監査

`audit/*.md` のシャードを `---` の行で区切り、各ブロックを1件の記録にする。区切りの前のファイル見出しだけのブロックは記録しない。時刻はブロックの最初の `**Timestamp**:`、種別は `**Event**:`、その他の `**名前**: 値` をフィールドとして読む。全シャードを時刻・パス・順で並べてから変換する。

- 全記録に `original_type`（v2 名、Event がなければ `UNTYPED`）、`raw`（ブロックの原文）、`source_path`（`元のパス#L行`）を付ける。`actor` は記録したフック（`hook`）とし、元の主体は raw に残す。ID は Intent・出所・原文から決め、再実行で同じ記録になる。
- 時刻が欠損・不正なら同じシャードの直前（なければ直後）の時刻を使い `estimated: true` を付ける。シャードに有効な時刻が1つもなければ MIGRATE-AUDIT として `apply` を拒否する。
- 変換は `audit-migration.json` の候補のうち、必須値を復元できる3種に限る。STAGE_STARTED は Vouch ステージごとに最初の1件を `stage.started` に、STAGE_COMPLETED は観測が completed のステージで最後の1件を、変換済みの開始を親として `stage.completed`（所要時間は時刻差で `estimated: true`）にする。build は loop_iterations / tests を復元できないため変換しない。RULE_LEARNED は `learn.recorded`（rules_added 1）にする。
- それ以外は `legacy.<NAME>` に原文を保存する。intent / unit の risk、session、Q-n と選択肢、gate のソース、review の harness、sensor の検査種別、codekb の更新の範囲など、必須の意味や値を復元できないためである。`GATE_APPROVED` から Intent 承認を推測しない。
- `estimated` の記録は report で実測から除き、件数だけを示す。

人の決定の候補（`audit.decisions` の種別）は移行レポート §6 に監査 ID と出所を並べる。モデルは原文のまま decisions.md の「判断と採用しなかった案」へ抽出し、Vouch の承認・確認点・回答としては記録しない。

## 規約・codekb

規約は §7 に affirm の証跡と各ファイルの扱いを示す。証跡がある時だけ team.md / project.md をモデルが vouch/rules.md に統合し、affirm されていない org / phases の既定は落とす。

codekb は §8 に repo ごとのファイル数と `reverse-engineering-timestamp.md` の `Date:` / `Commit:` を示す。完全な SHA でない commit は世代を検証できない。explorer が knowledge/codekb/&lt;repo&gt;/ と索引を書き、移行の直後に `vouch knowledge check` を実行する。古い・不明な世代は既存の鮮度検査の手順で再走査する。

## 移行レポートと承認

`apply` は Intent のフォルダに `migration.md`（`rules.md` の language、なければ既定 ja）を書く。frontmatter は `status: draft`、`source`、`intent`、`files`。§1 結論、§2 進捗、§3 全件表、§4 行き先のないファイル、§5 監査の変換、§6 人の決定の候補、§7 規約、§8 codekb、§9 推測しなかったことを持つ。生成は決定的で、同じ移行元なら同じバイトになる。

人は `vouch migrate approve <migration.md の sha256>` を入力する。UserPromptSubmit のフックは、設定した Intent（`VOUCH_INTENT`）の migration.md が `status: draft` で digest が一致し、プロンプトの識別子がある時だけ `migration.completed`（actor human、files_migrated、revision、submission）を記録し、モデルへは送らない。digest が違う・レポートがない・形式が違う時は理由を返して記録しない。移行の承認は Intent の承認ではない。

## 再実行・部分失敗・衝突

- 書き込みは「なければ作る、同じなら何もしない」に限る。`apply` は全ての書き込み先を先に検査し、1つでも異なる内容があれば MIGRATE-TARGET で何も書かない。
- archive → 監査 → 移行レポートの順に書く。途中で失敗しても、再実行は書けた分を同一として飛ばし、残りを書く。監査の追記は1回の原子的な置換である。
- Intent のフォルダに移行レポートがないのに成果物がある、または監査にこの移行以外の記録だけがある場合は、別の Intent と衝突しているとして拒否する。
- 結果の JSON は全ファイル数、archive 済み・同一、監査ブロック・変換・legacy・推定の数を返す。数の合計は元ファイル数・ブロック数と一致する。
