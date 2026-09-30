import { deriveFixture } from "../helpers/fixtures.mjs";
import { gitIn } from "../helpers/git-guard.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import {
  artifact,
  date,
  document,
  knowledgeFiles,
  paths,
  question,
} from "../helpers/knowledge.mjs";
import { capturedPrompt, runHook, sandbox } from "../helpers/runtime.mjs";

for (const harness of /** @type {const} */ (["claude", "codex"])) {
  test(`${harness} citations bind committed code and reject unindexed knowledge in artifact and question evidence`, async (t) => {
    const box = await sandbox(t);
    await box.write("src/main.mjs", "one\n");
    gitIn(box.root, "add", "src/main.mjs");
    gitIn(box.root, "commit", "-qm", "initial");
    const head = gitIn(box.root, "rev-parse", "HEAD").trim();
    const initial = knowledgeFiles();
    const index = JSON.parse(initial["vouch/knowledge/index.json"]);
    index.generation = head;
    initial["vouch/knowledge/index.json"] = JSON.stringify(index);
    for (const [path, text] of Object.entries(initial))
      await box.write(path, text);
    const base = "vouch/intents/citations/";
    await box.write(`${base}decisions.md`, question + artifact);
    let submission = 0;
    const send = () =>
      runHook(
        "vouch-record-intent-review",
        deriveFixture(capturedPrompt(harness), {
          cwd: box.root,
          prompt: "vouch citations check",
          [harness === "claude" ? "prompt_id" : "turn_id"]:
            `citation-${++submission}`,
        }),
        { root: box.root, intent: "citations", instant: `${date}T12:00:00Z` },
      );
    const source = (/** @type {string} */ target) =>
      `<!-- sec:references -->\n[x](${target})`;
    await box.write(`${base}intent.md`, source(`src/main.mjs:1@${head}`));
    t.assert.match(send().stderr, /passed/);
    await box.write("src/main.mjs", "one\nnew uncommitted line\n");
    await box.write(`${base}intent.md`, source(`src/main.mjs:2@${head}`));
    t.assert.match(send().stderr, /stale code reference/);
    await box.write("src/untracked.mjs", "untracked\n");
    await box.write(`${base}intent.md`, source(`src/untracked.mjs:1@${head}`));
    t.assert.match(send().stderr, /missing committed code/);
    await box.write("vouch/knowledge/codekb/extra.md", document);
    await box.write(
      `${base}intent.md`,
      source(`./vouch/knowledge/codekb/extra.md#main@${date}`),
    );
    t.assert.match(send().stderr, /unindexed knowledge reference/);
    await box.write(`${base}intent.md`, artifact);
    await box.write(
      `${base}decisions.md`,
      question.replaceAll(
        `[basis](${paths[0]}#main@${date})`,
        `[code](src/main.mjs:2@${head})`,
      ) + artifact,
    );
    t.assert.match(send().stderr, /stale code reference/);
  });
}
