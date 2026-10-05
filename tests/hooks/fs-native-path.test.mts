import { mkdir, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import operations from "../../core/registry/operations.json" with {
  type: "json",
};
import { hookTest as test } from "../helpers/hook-test.mjs";
import { runHook, sandbox, sessionFor } from "../helpers/runtime.mjs";

test("recording hooks append twice and release their lock beneath a Japanese path", async (t) => {
  const box = await sandbox(t, { git: false });
  const root = box.path("日本語 project $ apostrophe'");
  await mkdir(root);
  const fixture = sessionFor(root);
  const sessions = ["日本語-session-1", "日本語-session-2"];
  const intent = "unicode-cleanup";
  t.plan(4);
  for (const session of sessions) {
    const result = runHook(
      "vouch-record-session-start",
      {
        ...fixture,
        payload: { ...fixture.payload, session_id: session },
      },
      { root, intent },
    );
    t.assert.deepEqual(
      [
        result.exitCode,
        result.stdout.startsWith(`${operations.labels.ja.summary}\n`),
        result.stderr,
      ],
      [0, true, ""],
    );
  }
  const directory = resolve(root, `vouch/intents/${intent}/audit`);
  const log = await readFile(resolve(directory, "events.jsonl"), "utf8");
  t.assert.deepEqual(
    log
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line).session),
    sessions,
  );
  t.assert.deepEqual(await readdir(directory), ["events.jsonl"]);
});
