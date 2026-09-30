import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { deriveFixture } from "../helpers/fixtures.mjs";
import { hookTest } from "../helpers/hook-test.mjs";
import { artifact, knowledgeFiles, question } from "../helpers/knowledge.mjs";
import { validator } from "../helpers/registry.mjs";
import { capturedPrompt, runHook, sandbox } from "../helpers/runtime.mjs";

for (const harness of /** @type {const} */ (["claude", "codex"])) {
  hookTest(
    `${harness} product hook records freshness, refresh, citation failures and replays`,
    async (t) => {
      const box = await sandbox(t);
      execFileSync("git", [
        "-C",
        box.root,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-qm",
        "initial",
      ]);
      const generation = execFileSync(
        "git",
        ["-C", box.root, "rev-parse", "HEAD"],
        { encoding: "utf8" },
      ).trim();
      const initial = knowledgeFiles();
      const index = JSON.parse(initial["vouch/knowledge/index.json"]);
      index.generation = generation;
      initial["vouch/knowledge/index.json"] = JSON.stringify(index);
      for (const [path, text] of Object.entries(initial))
        await box.write(path, text);
      const intent = "knowledge-test";
      await box.write(`vouch/intents/${intent}/intent.md`, artifact);
      await box.write(
        `vouch/intents/${intent}/decisions.md`,
        question + artifact,
      );
      /** @param {string} prompt @param {string} [id] */
      const send = (prompt, id = prompt) =>
        runHook(
          "vouch-record-intent-review",
          deriveFixture(capturedPrompt(harness), {
            cwd: box.root,
            prompt,
            [harness === "claude" ? "prompt_id" : "turn_id"]: id,
          }),
          { root: box.root, intent, instant: "2026-09-27T12:00:00Z" },
        );
      t.assert.match(send("vouch knowledge check").stderr, /VOUCH-KNOWLEDGE/);
      t.assert.match(send("vouch knowledge refresh").stderr, /refreshed/);
      t.assert.match(send("vouch citations check").stderr, /passed/);
      const audit = `vouch/intents/${intent}/audit/events.jsonl`;
      const before = await box.read(audit);
      send("vouch knowledge refresh");
      t.assert.equal(await box.read(audit), before);
      await box.write(
        `vouch/intents/${intent}/intent.md`,
        "<!-- sec:references -->\n[x](../outside.md#main@2026-09-27)",
      );
      t.assert.match(send("vouch citations check", "bad").stderr, /failed/);
      const rows = (await box.read(audit))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      t.assert.ok(rows.some((r) => r.type === "knowledge.refreshed"));
      t.assert.ok(
        rows.some((r) => r.type === "hook.check" && r.check === "freshness"),
      );
      t.assert.ok(rows.some((r) => r.type === "hook.denied"));
      const validate = validator("audit-event");
      t.assert.ok(
        rows.every((r) => validate(r)),
        JSON.stringify(validate.errors),
      );
    },
  );
}
test("knowledge index schema rejects incomplete or ill typed entries", (t) => {
  const validate = validator("knowledge-index");
  t.assert.equal(
    validate(JSON.parse(knowledgeFiles()["vouch/knowledge/index.json"])),
    true,
  );
  t.assert.equal(
    validate({ version: 1, generation: "short", scope: "diff", entries: [] }),
    false,
  );
});
