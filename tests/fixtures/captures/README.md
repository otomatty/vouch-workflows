# Claude Code 実機記録

- 日付: 2026-09-27
- CLI: `C:\Users\saedg\.local\bin\claude.exe --version` → `2.1.280 (Claude Code)`
- 実行ディレクトリ: `%TEMP%\vouch-capture-20260927`
- 採取時のリポジトリ HEAD: `d4d5a02`（fixture 自体のコミットを意味しません）
- 原文: `claude-2.1.280.jsonl`。記録用フックが stdin の JSON 値を1行として保存したものです。
- 包装: `../harness/claude/UserPromptSubmit.json`。payload は原文と同値、`synthetic: false` です。

専用 settings の SessionStart と UserPromptSubmit に `node record.mjs raw.jsonl` を設定しました。記録用スクリプトは UserPromptSubmit で stderr に理由を出して exit 2 にし、モデルに送信する前に止めました。採取された行は UserPromptSubmit 1件だけです。SessionStart は採取済みと扱いません。

```powershell
claude --print 'Vouch fixture capture. The UserPromptSubmit hook blocks this prompt before model execution.' --restricted --settings settings.json --strict-mcp-config --no-session-persistence --max-budget-usd 0.01
```

同梱の `record.mjs` は実際に使用した採取スクリプトです。再採取時は専用 settings に、実行環境の Node・このスクリプト・出力先の絶対パスを引用符付きで設定します。採取先をプロジェクトの設定に組み込む必要はありません。

子プロセステストでは cwd だけを sandbox に合わせ、外側のメタデータを `synthetic: true / provenance: synthetic` に変えます。負例はその入力を明示的に壊したものです。テスト用 driver が作る audit も synthetic とし、製品イベントの発火実績には数えません。
