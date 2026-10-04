import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { cursorInput, distribution, installRun } from "../helpers/install.mjs";
import { planned, topics } from "../helpers/intent-review.mjs";
import { validator } from "../helpers/registry.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("source launcher has an explicit manual failure and fail-open native boundary", async (t) => {
  const box = await sandbox(t);
  for (const [action, status] of [
    ["doctor", 2],
    ["session", 0],
  ]) {
    const result = spawnSync(
      process.execPath,
      [resolve("core/hooks/vouch-launch.mjs"), String(action)],
      { cwd: box.root, encoding: "utf8" },
    );
    t.assert.equal(result.status, status);
    t.assert.match(result.stderr, /VOUCH-LAUNCH:/);
  }
});
/** Synthetic transport examples only; these cases do not claim native Cursor execution. */
async function cursorProject(t: import("node:test").TestContext) {
  const box = await sandbox(t);
  await mkdir(box.path("project"));
  distribution(t, box);
  const installed = installRun("install", box, "cursor", "project", [
    "--intent",
    "bridge",
  ]);
  t.assert.equal(installed.status, 0, installed.stdout);
  const runtime: string = JSON.parse(installed.stdout).runtimeRoot;
  const entry = join(runtime, "hooks/vouch-launch.mjs");
  await box.write("project/vouch/intents/bridge/intent.md", planned());
  let generation = 0;
  function send(
    action: string,
    event: string,
    fields: Record<string, unknown>,
  ) {
    const input = cursorInput(box.path("project"), event, {
      generation_id: `generation-${++generation}`,
      ...fields,
    });
    const result = spawnSync(
      process.execPath,
      [entry, action, "project", box.path("project")],
      { input: JSON.stringify(input), encoding: "utf8", timeout: 4000 },
    );
    t.assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  const audit = "project/vouch/intents/bridge/audit/events.jsonl";
  const rows = async () =>
    (await box.read(audit))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return { box, runtime, entry, send, audit, rows };
}
test("synthetic Cursor bridge records confirmation and approval and answers with native permissions", async (t) => {
  const { box, send, audit, rows } = await cursorProject(t);
  const denied = send("guard", "preToolUse", {
    tool_name: "Write",
    tool_input: { path: "src/new.mjs", content: "implementation" },
  });
  t.assert.equal(denied.permission, "deny");
  t.assert.match(denied.user_message, /VOUCH-BUILD-UNAPPROVED/);
  for (const topic of topics) {
    const confirmed = send("prompt", "beforeSubmitPrompt", {
      prompt: `vouch confirm ${topic}`,
    });
    t.assert.equal(confirmed.continue, false);
    t.assert.match(confirmed.user_message, /VOUCH-CHECKPOINT-RECORDED/);
  }
  const review = send("prompt", "beforeSubmitPrompt", {
    prompt: "vouch review",
  });
  t.assert.equal(review.continue, false);
  t.assert.match(review.user_message, /VOUCH-REVIEW-RECORDED/);
  const before = await box.read(audit);
  const gate = (await rows()).findLast((row) => row.type === "gate.opened");
  send("prompt", "beforeSubmitPrompt", {
    prompt: `vouch approve ${gate.id}`,
    generation_id: undefined,
  });
  t.assert.equal(
    await box.read(audit),
    before,
    "missing identity never invents approval evidence",
  );
  const approved = send("prompt", "beforeSubmitPrompt", {
    prompt: `vouch approve ${gate.id}`,
  });
  t.assert.match(approved.user_message, /VOUCH-APPROVAL-APPLIED/);
  t.assert.match(
    await box.read("project/vouch/intents/bridge/intent.md"),
    /status: approved/,
  );
  const recorded = await rows();
  t.assert.equal(
    recorded.every(
      (row) => row.harness === "cursor" && validator("audit-event")(row),
    ),
    true,
  );
  t.assert.equal(recorded.at(-1).submission.field, "turn_id");
});
test("synthetic Cursor bridge keeps the answer for stop and refuses protected writes and deletes", async (t) => {
  const { box, runtime, entry, send, audit, rows } = await cursorProject(t);
  send("prompt", "beforeSubmitPrompt", {
    prompt: "/vouch ask Why this design?",
    generation_id: "aside",
  });
  t.assert.deepEqual(
    send("stop", "afterAgentResponse", { generation_id: "aside" }),
    {},
  );
  send("stop", "stop", {
    text: "An evidence-based answer.",
    generation_id: "aside",
  });
  const aside = (await rows()).filter((row) => row.type === "aside.answered");
  t.assert.equal(aside.length, 1);
  t.assert.equal(aside[0].answer, "An evidence-based answer.");
  for (const target of [
    "vouch/config.json",
    ".cursor/hooks.json",
    join(runtime, "hooks/lib/env.mjs"),
  ]) {
    const refused = send("guard", "preToolUse", {
      tool_name: "Write",
      tool_input: { path: target, content: "tamper" },
    });
    t.assert.equal(refused.permission, "deny");
    t.assert.match(refused.user_message, /VOUCH-GUARD-INSTALLATION/);
  }
  const before = await box.read(audit);
  for (const target of [audit.slice("project/".length), "."]) {
    const refused = send("guard", "preToolUse", {
      tool_name: "Delete",
      tool_input: { path: target },
    });
    t.assert.equal(refused.permission, "deny", target);
    t.assert.match(refused.user_message, /VOUCH-GUARD-AUDIT/);
  }
  t.assert.equal(await box.read(audit), before);
  const doctor = spawnSync(process.execPath, [entry, "doctor", "manual"], {
    cwd: box.path("project"),
    encoding: "utf8",
  });
  t.assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
});
