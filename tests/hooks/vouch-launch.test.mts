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
test("synthetic Cursor bridge records confirmation and approval and returns native write denials", async (t) => {
  const box = await sandbox(t);
  await mkdir(box.path("project"));
  distribution(t, box);
  const installed = installRun("install", box, "cursor", "project", [
    "--intent",
    "bridge",
  ]);
  t.assert.equal(installed.status, 0, installed.stdout);
  const runtime = JSON.parse(installed.stdout).runtimeRoot;
  const entry = join(runtime, "hooks/vouch-launch.mjs");
  await box.write("project/vouch/intents/bridge/intent.md", planned());
  let generation = 0;
  /** Synthetic transport examples only; this test does not claim native Cursor execution. */
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
  const denied = send("guard", "preToolUse", {
    tool_name: "Write",
    tool_input: { path: "src/new.mjs", content: "implementation" },
  });
  t.assert.equal(denied.decision, "deny");
  for (const topic of topics) {
    const confirmed = send("prompt", "beforeSubmitPrompt", {
      prompt: `vouch confirm ${topic}`,
    });
    t.assert.equal(confirmed.continue, false);
    t.assert.match(confirmed.user_message, /VOUCH-CHECKPOINT-RECORDED/);
  }
  send("prompt", "beforeSubmitPrompt", { prompt: "vouch review" });
  const path = "project/vouch/intents/bridge/audit/events.jsonl";
  const before = await box.read(path);
  const gate = before
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .findLast((row) => row.type === "gate.opened");
  send("prompt", "beforeSubmitPrompt", {
    prompt: `vouch approve ${gate.id}`,
    generation_id: undefined,
  });
  t.assert.equal(
    await box.read(path),
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
  const rows = (await box.read(path))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  t.assert.equal(
    rows.every(
      (row) => row.harness === "cursor" && validator("audit-event")(row),
    ),
    true,
  );
  t.assert.equal(rows.at(-1).submission.field, "turn_id");
  send("prompt", "beforeSubmitPrompt", {
    prompt: "/vouch ask Why this design?",
    generation_id: "aside",
  });
  send("stop", "afterAgentResponse", {
    text: "An evidence-based answer.",
    generation_id: "aside",
  });
  send("stop", "stop", { generation_id: "aside" });
  const aside = (await box.read(path))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((row) => row.type === "aside.answered");
  t.assert.equal(aside.length, 1);
  t.assert.equal(aside[0].answer, "An evidence-based answer.");
  for (const target of [
    "vouch/config.json",
    ".cursor/hooks.json",
    join(runtime, "hooks/lib/env.mjs"),
  ]) {
    const protectedResult = send("guard", "preToolUse", {
      tool_name: "Write",
      tool_input: { path: target, content: "tamper" },
    });
    t.assert.equal(protectedResult.decision, "deny");
    t.assert.match(protectedResult.reason, /VOUCH-GUARD-INSTALLATION/);
  }
  const doctor = spawnSync(process.execPath, [entry, "doctor", "manual"], {
    cwd: box.path("project"),
    encoding: "utf8",
  });
  t.assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
});
