# Vouch workflows

Claude Code と Codex 向けの開発ワークフロー。仕様書は [docs/README.md](docs/README.md) から参照できます。

レジストリ、入出力スキーマ、JSDoc の契約、共通ランタイムと、Claude / Codex のセッション開始を記録する最初の製品フックを実装しています。両ハーネスの登録設定と配布生成、配布先を読み取り検査する doctor も実装しました。doctor と読み取り専用 status の共通 Skill、配布先の AGENTS.md、日英の rules テンプレートも実装しました。Intent の下書き Skill と日英 intent / decisions テンプレートも追加しました。人の明示入力による確認点と承認の記録、確認点がそろった時の approved への更新、承認済み計画のない実装の書き込み（ファイル編集ツールと、シェルのリダイレクト・既定の書き込みコマンド）の遮断を実装し、範囲と限界を[承認の境界](docs/development/approval-boundary.md)に記載しています。知識の配置・世代管理、鮮度・引用・判断依頼カードの検査を [知識レイヤーの契約](docs/development/knowledge.md)に追加しました。必要時の調査は Knowledge / explorer Skill を使います。Design・Build・Verify のステージ Skill と、design.md・build-log.md・review.md（Review Brief）の日英テンプレートも追加し、Build は builder、Verify は reviewer のエージェントを起動します。範囲と限界は [Design・Build・Verify の Skill と日英成果物](docs/development/stages.md) に記載しています。ask / report / migrate の操作と、質問・レビュー・Unit・ステージの監査イベントを記録するフックは未実装です。ハーネスのツールから監査ログ・フック設定・承認済み成果物への書き込みを遮る PreToolUse のガードは実装済みで、検査できる範囲と限界を[書き込み保護](docs/development/write-guard.md)に記載しています。[レジストリ契約](docs/development/contracts.md)、[共通ランタイム](docs/development/runtime.md)、[セッション開始の検証記録](docs/development/session-start.md)、[Claude 配布の契約](docs/development/claude-distribution.md)、[Codex 配布の契約](docs/development/codex-distribution.md)、[doctor の契約](docs/development/doctor.md)に範囲を記載しています。既知の Windows の記録系 p95 時間予算は未達です。測定環境ごとの結果を検証記録に分けて残しています。

## 開発環境

Node.js 22.19.0 以上、npm 10 以上、Git を使用します。ローカルの基準は Node.js 24.13.0 です。

```sh
npm ci
npm run doctor
npm run check
```

Windows で既存の npm 起動スクリプトが `MODULE_NOT_FOUND` になる場合は、Node.js 同梱の npm を直接使うラッパーで実行できます。

```powershell
.\scripts\npm.ps1 ci
.\scripts\npm.ps1 run doctor
.\scripts\npm.ps1 run check
```

lockfile を書き換えるときは npm 11.5.0〜11.6.2 を使いません。版と手順は [lockfile の生成](docs/development/lockfile.md) を参照してください。

依存パッケージはすべて開発用です。利用者に配るコードは Node.js 組み込みモジュールだけで動く `.mjs` とし、ビルドを挟みません。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run doctor` | Node.js、Git、固定バージョンの依存の導入状況 |
| `npm run check` | Lint・型・非フック検査を並列に実行 → フック検査 → 配布生成・バイト一致。CI と共通の入口。全体の時間予算は既定90秒・Windows 150秒（[check 全体の時間予算](docs/development/check-budget.md)） |
| `npm run lint` | Biome、markdownlint、dependency-cruiser、knip |
| `npm run format` | JS / JSON の整形と安全な自動修正 |
| `npm run typecheck` | `.mjs` の JSDoc を TypeScript 6 で検査 |
| `npm test` | 実装済みのテスト階層を実行 |
| `npm run test:unit` | lib の単体テスト。未実装なら失敗 |
| `npm run test:hooks` | 共通 io とセッション開始フックの子プロセステスト・カバレッジ・時間予算 |
| `npm run package` | `dist/claude/` と `dist/codex/` に現在の配布を生成 |
| `npm run package:check` | 既存の配布のファイル集合とバイト一致を読み取り専用で検査 |
| `npm run mutate` | lib のミューテーション検査。スコアは未測定 |

環境の検証範囲と後続作業は [開発環境の説明](docs/development/setup.md) を参照してください。

監査ログ検証の補助測定は `node scripts/benchmark-audit.mjs` で実行できます。synthetic なログの検索・追記だけを測定します。プロセス起動を含む時間予算の合否は `test:hooks` で検査します。[性能改善の記録](docs/development/audit-performance.md)に両者を分けて記載しています。

配布先では `node .claude/hooks/vouch-doctor.mjs` または `node .codex/hooks/vouch-doctor.mjs` で Node / Git、必要ファイル、登録設定を診断できます。開発用の `npm run doctor` とは別のコマンドです。詳細と確認範囲は [doctor](docs/development/doctor.md)を参照してください。

プロセス起動の補助測定は `node scripts/benchmark-hook.mjs` です。7条件（レビュー開始を含む）を交互に20回測り、p50 / p95 と生データを JSON で出力します。`--load` を付けると、CPU 数より1少ない数の背景プロセスが no-op フックを起動し続ける中で測ります。PowerShell / sh の起動は `node scripts/benchmark-shell.mjs` で環境変数とコマンドごとに比べます。GitHub Actions の Benchmark ワークフローは、これらを Windows / Ubuntu × Node.js 22.19.0 / 24.x で実行し、生データを artifact に残します。予算の合否は従来どおり `test:hooks` などのテストが判定します。

配布先の Skill は Claude で `/vouch doctor`・`/vouch status`、Codex で `$vouch doctor`・`$vouch status` と指定します。引数なしでは対応範囲を案内します。ask / report / migrate は未実装です。[Skill の契約と検証範囲](docs/development/doctor-skill.md)を参照してください。

status は成果物と監査を根拠に現在地・確認点・未回答の判断依頼を表示する Skill です。状態を遷移させるランタイムは追加していません。モデルによる振る舞いの評価は未実施です。[status と共通文書](docs/development/status.md)に検証範囲を記載しています。日英の rules テンプレートは配布先の templates/ に置き、既存の `vouch/rules.md` は変更しません。

新規の計画作成や指定した下書きの修正は Claude で `/vouch-intent`、Codex で `$vouch-intent` を使います。Skill は `status: draft` の計画と判断記録を作ります。確認点は人が `vouch confirm <対象>`、承認は `vouch review` で開いたゲートに `vouch approve <ゲート ID>` を入力した時にフックが記録し、確認点がそろった時だけフックが approved にします。[Intent 下書きの契約と検証範囲](docs/development/intent.md)と[承認の境界](docs/development/approval-boundary.md)を参照してください。

Intent Skill の実ハーネスでの発見・選択・生成結果の評価は未実施です。現在の自動テストは契約・文書構造・配布を検査します。

workflow.json の3役のエージェント（builder / reviewer / explorer）を `core/agents/` に1つずつ定義し、`npm run package` が Claude の `.claude/agents/*.md` と Codex の `.codex/agents/*.toml` を生成します。Codex の TOML は原本の Markdown へ逆変換でき、往復の一致をテストします。エージェントを起動する Build / Verify の Skill と、実際のモデルが役割を守るかの評価は未実施です。[エージェントの契約と検証範囲](docs/development/agents.md)を参照してください。

Build の機械的なガードとして、登録したシェルツールからの `main` への push と `gh pr merge`、Intent のブランチでのコードを変えるコミットの型と Unit、`test` 型以外でのテストファイルの変更・削除、契約（DoD 合格）→ テスト（DoD 不合格）→ 実装の順序の違反と、実装を含むブランチでコードを変えた最後のコミットに DoD 合格（green）の証跡がない push を PreToolUse のガードが遮ります。DoD は配布先で `node .claude/hooks/vouch-dod.mjs`（Codex は `.codex`）が `vouch/rules.md` の表のコマンドを実行し、出力・結果・所要時間を build-log.md と監査に記録します。本番データの操作など判断が要る範囲との区別、検査できる経路と限界は [Git 操作の検査と DoD](docs/development/git-guard.md) に記載しています。現在の[コーディング規則](docs/development/coding-rules.md)は、責務ごとの分割と依存方向を基準にし、ファイル単位の上限を維持しています。

Design が必要な計画の設計は `/vouch-design`（Codex は `$vouch-design`）、承認済み Intent の実装は `/vouch-build`、別コンテキストの検証と Review Brief・Learn は `/vouch-verify` を使います。design.md の採択は人の `vouch confirm design`、PR のマージは人が行います。Skill は4ステージのまま状態機械を持たず、承認・確認・マージを代行しません。自動テストは構造・正典との一致・配布だけを検査し、モデルがこれらの Skill に従うかの評価は未実施です（[Design・Build・Verify の Skill と日英成果物](docs/development/stages.md)）。
