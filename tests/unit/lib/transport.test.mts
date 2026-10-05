import { resolve } from "node:path";
import { test } from "node:test";
import {
  cursorIgnored,
  cursorInput,
  cursorOutput,
  cursorPass,
} from "../../../core/hooks/lib/transport.mjs";

// These are synthetic protocol examples, not inventoried native captures.
const base = {
  conversation_id: "conversation",
  hook_event_name: "sessionStart",
};
test("Cursor normalization retains native identities and ignores payload root and harness claims", (t) => {
  t.assert.deepEqual(cursorInput(base, "/trusted"), {
    session_id: "conversation",
    cwd: "/trusted",
    hook_event_name: "SessionStart",
    source: "startup",
  });
  t.assert.deepEqual(
    cursorInput(
      {
        ...base,
        cwd: "/native",
        generation_id: "generation",
        source: "resume",
        harness: "claude",
        intent: "invented",
      },
      "/trusted",
    ),
    {
      session_id: "conversation",
      cwd: "/native",
      turn_id: "generation",
      hook_event_name: "SessionStart",
      source: "resume",
    },
  );
  const prompt = cursorInput(
    {
      ...base,
      hook_event_name: "beforeSubmitPrompt",
      prompt: "vouch review",
      generation_id: "g",
    },
    "/trusted",
  );
  t.assert.equal(prompt?.turn_id, "g");
  t.assert.equal(
    cursorInput(
      { ...base, hook_event_name: "beforeSubmitPrompt", prompt: "review" },
      "/trusted",
    )?.turn_id,
    undefined,
  );
  for (const name of [
    "Write",
    "write_file",
    "Edit",
    "StrReplace",
    "Shell",
    "run_terminal_cmd",
    "apply_patch",
    "unknown",
  ])
    t.assert.deepEqual(
      cursorInput(
        {
          ...base,
          hook_event_name: "preToolUse",
          tool_name: name,
          tool_input: { path: "a" },
          tool_use_id: "tool",
        },
        "/trusted",
      )?.tool_input,
      { path: "a", file_path: "a" },
    );
  t.assert.equal(
    cursorInput(
      {
        ...base,
        hook_event_name: "preToolUse",
        tool_name: "Write",
        tool_input: { file_path: "b", path: "a" },
      },
      "/trusted",
    )?.tool_use_id,
    undefined,
  );
  t.assert.equal(
    cursorInput(
      {
        ...base,
        hook_event_name: "preToolUse",
        tool_name: "Write",
        tool_input: {},
      },
      "/trusted",
    )?.hook_event_name,
    "PreToolUse",
  );
  for (const event of ["stop", "afterAgentResponse"]) {
    t.assert.equal(
      cursorInput(
        { ...base, hook_event_name: event, text: "response" },
        "/trusted",
      )?.last_assistant_message,
      "response",
    );
    t.assert.equal(
      cursorInput({ ...base, hook_event_name: event }, "/trusted")
        ?.last_assistant_message,
      undefined,
    );
  }
});
test("unrecognized or incomplete Cursor events do not invent canonical evidence", (t) => {
  for (const value of [
    null,
    [],
    {},
    { ...base, conversation_id: "" },
    { ...base, hook_event_name: "" },
    { ...base, hook_event_name: "futureEvent" },
    { ...base, hook_event_name: "beforeSubmitPrompt", prompt: "" },
    { ...base, hook_event_name: "preToolUse" },
    {
      ...base,
      hook_event_name: "preToolUse",
      tool_name: "Write",
      tool_input: [],
    },
  ])
    t.assert.equal(cursorInput(value, "/trusted"), null);
});
test("Cursor responses follow the native permission and continue contract on every path", (t) => {
  const denied = { status: 2, stdout: "", stderr: " reason \n" };
  const allowed = { status: 0, stdout: "", stderr: "" };
  const failed = { status: null, stdout: "context", stderr: "failure" };
  t.assert.deepEqual(cursorOutput("guard", denied), {
    permission: "deny",
    user_message: "reason",
  });
  t.assert.deepEqual(cursorOutput("prompt", denied), {
    continue: false,
    user_message: "reason",
  });
  t.assert.deepEqual(cursorOutput("stop", denied), {});
  t.assert.deepEqual(
    cursorOutput("session", { status: 0, stdout: " context \n", stderr: "" }),
    { additional_context: "context" },
  );
  for (const result of [allowed, failed]) {
    t.assert.deepEqual(cursorOutput("guard", result), { permission: "allow" });
    t.assert.deepEqual(cursorOutput("prompt", result), { continue: true });
    t.assert.deepEqual(cursorOutput("session", result), {});
    t.assert.deepEqual(cursorOutput("stop", result), {});
  }
  // Inactive, stale and failed launches answer with the same pass shapes.
  t.assert.deepEqual(cursorPass("guard"), { permission: "allow" });
  t.assert.deepEqual(cursorPass("prompt"), { continue: true });
  t.assert.deepEqual(cursorPass("session"), {});
  t.assert.deepEqual(cursorPass("stop"), {});
});
test("Cursor Delete is a guarded removal and Shell working directories anchor relative paths", (t) => {
  for (const name of ["Delete", "delete_file"])
    t.assert.deepEqual(
      cursorInput(
        {
          ...base,
          hook_event_name: "preToolUse",
          tool_name: name,
          tool_input: { path: "vouch/x" },
        },
        "/trusted",
      ),
      {
        session_id: "conversation",
        cwd: "/trusted",
        hook_event_name: "PreToolUse",
        tool_name: "Delete",
        tool_input: { path: "vouch/x", file_path: "vouch/x" },
      },
    );
  const shell = (fields: Record<string, unknown>) =>
    cursorInput(
      {
        ...base,
        hook_event_name: "preToolUse",
        tool_name: "Shell",
        tool_input: { command: "rm events.jsonl", ...fields },
        cwd: "/native",
      },
      "/trusted",
    )?.cwd;
  t.assert.equal(shell({}), "/native");
  // Resolved as the platform does: on Windows "/elsewhere" gains the current drive.
  t.assert.equal(
    shell({ working_directory: "/elsewhere" }),
    resolve("/native", "/elsewhere"),
  );
  t.assert.equal(
    shell({ working_directory: "sub/dir" }),
    resolve("/native", "sub/dir"),
  );
  t.assert.equal(
    cursorInput(
      {
        ...base,
        hook_event_name: "preToolUse",
        tool_name: "Write",
        tool_input: { path: "a", working_directory: "/elsewhere" },
        cwd: "/native",
      },
      "/trusted",
    )?.cwd,
    "/native",
  );
});
test("an afterAgentResponse without text leaves the answer to the later stop", (t) => {
  t.assert.equal(
    cursorIgnored({ ...base, hook_event_name: "afterAgentResponse" }),
    true,
  );
  t.assert.equal(
    cursorIgnored({ ...base, hook_event_name: "afterAgentResponse", text: "" }),
    true,
  );
  for (const value of [
    { ...base, hook_event_name: "afterAgentResponse", text: "answer" },
    { ...base, hook_event_name: "stop" },
    null,
  ])
    t.assert.equal(cursorIgnored(value), false);
});
