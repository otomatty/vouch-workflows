import { test } from "node:test";
import {
  cursorInput,
  cursorOutput,
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
    const empty = cursorInput({ ...base, hook_event_name: event }, "/trusted");
    if (event === "afterAgentResponse") t.assert.equal(empty, null);
    else t.assert.equal(empty?.last_assistant_message, undefined);
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
    { ...base, hook_event_name: "afterAgentResponse", text: "" },
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
test("Cursor responses convert shared denials and context without changing workflow decisions", (t) => {
  const denied = { status: 2, stdout: "", stderr: " reason \n" };
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
  for (const action of ["session", "stop"])
    t.assert.deepEqual(
      cursorOutput(action, { status: 0, stdout: "", stderr: "" }),
      {},
    );
  t.assert.deepEqual(
    cursorOutput("session", {
      status: null,
      stdout: "context",
      stderr: "failure",
    }),
    {},
  );
  for (const status of [0, 1, null])
    t.assert.deepEqual(
      cursorOutput("guard", { status, stdout: "", stderr: "" }),
      { permission: "allow" },
    );
});
