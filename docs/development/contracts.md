# レジストリとフックの契約

決定の優先順位は [決定記録 §18](../spec/vouch-decision-record.html#s18)、各節、[実装ルール](../spec/vouch-implementation-rules.html)、[Q1〜Q6 の具体表](../spec/vouch-open-questions.html)です。元資料は変更しません。

## 今回の範囲

この文書はレジストリ段階（`d4d5a02`）の記録です。続く共通処理の実装・実機 fixture・現在の残件は[共通ランタイム](runtime.md)を参照してください。

レジストリ、JSON Schema draft 2020-12、JSDoc の型、これらの検査を実装しました。この段階ではフックの動作を代用する関数やダミーのエミッタは置いていません。契約を先にコミットし、型検査後に失敗テスト、最後に台帳と fixture を追加しています。

Q1 の「約25種」は概数です。具体表の全27種を採用します。Q3 は L=4層、M=8層、H=11層で、破壊検査は0/1/3箇所。依存監査は全階層の DoD に含めます。Q2・Q5・Q6 は `workflow.json` に記録します。

## データの境界

| ファイル | 契約 |
| --- | --- |
| `core/registry/audit-events.json` | 全27種の必須・任意フィールド、計測項目、対になるイベント |
| `core/registry/audit-event.schema.json` | 監査 JSONL の1行。イベントごとの必須項目と型 |
| `core/registry/hook-input.schema.json` | stdin の JSON 値。7イベントの共通項目と固有項目 |
| `core/registry/hook-result.schema.json` | `HookMain` の返値。allow / deny と完全な監査レコード |
| `core/registry/hook-process.schema.json` | 子プロセス観測値。0/2、JSON として解釈済みの stdout、stderr |
| `core/registry/harness-fixture.schema.json` | payload と採取元、ハーネス、版、合成の区別 |
| `core/hooks/lib/contracts.mjs` | 検証後の値の JSDoc。実行時処理は持たない |

その他の台帳も同名の `.schema.json` で検証します。Ajv は開発専用です。将来の `io.mjs` は依存ゼロで入力を検査し、同じ受理・拒否例を使ってスキーマとの差を検査します。

入力の未知フィールドは受理し、将来のアダプタで無視します。スキーマは未知フィールドを削除しません。`cwd` とファイルパスは信頼しません。trusted root は `HookContext.projectRoot` に渡し、解決後の包含検査とシンボリックリンク対策は `fs.mjs` で行います。空・非JSON・1 MB入力の扱い、必須欠落時の no-op、stdout の直列化、例外時0・遮断時2は後続のプロセステストで検査します。

`hook-process` の `stdout: null` は出力なしにも使用します。出力された JSON の `null` と空出力の区別、ハーネス固有の出力形式は `runHook()` の生文字列で検証します。この観測用スキーマはハーネス用アダプタの実装ではありません。

## 監査レコード

全イベントで `id/v/type/ts/actor` を必須とします。Intent 内のイベントには `intent`、セッションのイベントには `session` を要求します。`ts` は UTC の字句形式を検査します。実在日付かどうか、非負整数の範囲、対の時刻差や ID の一致は別の検査です。

`duration_ms` と `wait_ms` は計測対象で要求し、取得不能な値を0に置換しません。`tokens` は `in/out/cache` を用い、`harness: claude` の場合だけ許可します。Codex は省略します。`stage.completed` の Build は `loop_iterations/tests` を要求します。§11 の JSONL は説明例なので、新契約では Q1 の計測名を使います。

`pairs_with` は開始・完了および依頼・回答の型の対応です。順序や親の存在の証明にはなりません。`session.resumed.duration_ms` は復元時間なので親を必須にしません。`hook.check` は単一レコードで検査時間を記録します。

人の承認を示すイベントは `actor: human` を要求します。ただし JSON をそう書くだけでは承認の真正性を証明できません。`intent.approved` は Intent 採択、`gate.approved` はゲートの回答を記録します。同じ回答から両方が出る場合も、待ち時間を二重集計しない実装が必要です。

`question.asked` は非blocking時に既定案を要求します。既定案を作れない blocking 質問も表現できます。`question.defaulted` は承認の代替にはなりません。

## 移行と fixture

`audit-migration.json` のキーは元の `audit-format.md` の表から91名を抽出して照合します。値は新イベント名または `legacy` です。対応は変換候補であり、フィールド変換そのものではありません。

`ARTIFACT_UPDATED → knowledge.refreshed` は codekb の更新と確認できる場合だけです。`GATE_APPROVED → gate.approved` から Intent 承認を推測しません。旧ステージから4ステージへの分類や新しい必須計測値を復元できない場合も、`legacy.<NAME>` に原文を保存します。移行エンジンは後続です。

`legacy` レコードは `original_type/raw/source_path` を要求します。原文と元ファイルの対応、`type` の接尾辞の一致、移行件数は移行テストの対象です。

`tests/fixtures/audit/*.jsonl` は手製のスキーマ例で、`synthetic: true` を付けます。フックから採取した証跡とは扱いません。v2 の台帳 fixture はバイト単位のコピーを保存し、原本との一致を検査します。

Codex の既存実機 payload は元ファイルを変えず、メタデータを外側に付けます。記録に版番号がないため `version: null` とし、TEST-7 の契約実行には未適格と記録します。`emit.ts` の別検証の版番号や payload の `model` は流用しません。Claude Code は実機記録がありません。

## 実装済みと未実装の境界

検査の実体と残件は `enforcement-map.json` の `checks` に記録します。`implemented` には存在する検査ファイルと検査する範囲、`pending` には不足する検査を記載します。同じルールに両方ある場合は部分実装です。

REG-2 の schema fixture は今回追加しますが、全27種を実際に emit するフックの契約テストは未実装です。台帳のイベントを消してこの不足を隠しません。フック実装後に各イベントと子プロセステストの対応を検査します。

承認の真正性、追記専用・原子的な記録、冪等性、パストラバーサル防止、コミット順の自動検査、実測時間、フックのカバレッジは今回の成功から推定できません。Skill・エージェント・テンプレート・配布物・移行処理・シナリオも後続です。

## 今回の検証記録

2026-09-27 に Windows の Node.js 22.19.0 と 24.13.0 で `npm run check` が成功しました。Lint、型検査、content 9件・registry 27件・unit 2件の計38件です。既存8件に30件を追加しています。Ajv は strict モードでスキーマをコンパイルします。

契約コミットは `e610430`、失敗テストのコミットは `7c0e175` です。実装前のテスト実行は32件中28件が失敗しました。未作成の台帳・fixtureと、Ajv strict モードでのスキーマの条件分岐が失敗原因でした。テストの期待値を緩めず、台帳の追加とスキーマの修正で解消しています。

元仕様と `docs/aidlc-v2-reference/` に変更はありません。移行元台帳はバイト一致、Codex payload は元の JSON 値との一致をテストします。knip の未作成フック・配布物に関する既存の設定ヒントは残っています。

unit の2件は型契約とスキーマの検査です。実行時関数が存在しないため、カバレッジの空レポートを達成率として報告しません。フック・packaging・scenario の階層は未実装です。

次段階は版付き実機 fixture、`sandbox()`・`runHook()`・fake clock、共通ランタイムです。REG-2 の発火実績は、その後の製品フックで検証します。共通処理の driver は REG-2 の実績には含めません。
