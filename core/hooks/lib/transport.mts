import { resolve } from "node:path";

// Native Cursor transport only; workflow decisions stay in shared product hooks.
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** Documented shapes; synthetic adapter tests are distinct from captured native fixtures. */
export function cursorInput(
  value: unknown,
  root: string,
): Record<string, unknown> | null {
  if (
    !object(value) ||
    !text(value.conversation_id) ||
    !text(value.hook_event_name)
  )
    return null;
  const base = {
    session_id: value.conversation_id,
    cwd: text(value.cwd) ? value.cwd : root,
    ...(text(value.generation_id) ? { turn_id: value.generation_id } : {}),
  };
  if (value.hook_event_name === "sessionStart")
    return {
      ...base,
      hook_event_name: "SessionStart",
      source: text(value.source) ? value.source : "startup",
    };
  if (value.hook_event_name === "beforeSubmitPrompt" && text(value.prompt))
    return {
      ...base,
      hook_event_name: "UserPromptSubmit",
      prompt: value.prompt,
    };
  if (
    value.hook_event_name === "preToolUse" &&
    text(value.tool_name) &&
    object(value.tool_input)
  ) {
    const names = {
      Write: "Write",
      write: "Write",
      write_file: "Write",
      Edit: "Edit",
      StrReplace: "Edit",
      str_replace: "Edit",
      edit_file: "Edit",
      Bash: "Bash",
      Shell: "Bash",
      shell: "Bash",
      run_terminal_cmd: "Bash",
      apply_patch: "apply_patch",
      Delete: "Delete",
      delete_file: "Delete",
    } as Record<string, string>;
    const input = { ...value.tool_input };
    if (!Object.hasOwn(input, "file_path") && text(input.path))
      input.file_path = input.path;
    const tool = names[value.tool_name] ?? value.tool_name;
    return {
      ...base,
      // A shell runs where its working_directory says; relative words resolve there.
      ...(tool === "Bash" && text(input.working_directory)
        ? { cwd: resolve(base.cwd, input.working_directory) }
        : {}),
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: input,
      ...(text(value.tool_use_id) ? { tool_use_id: value.tool_use_id } : {}),
    };
  }
  if (
    value.hook_event_name === "stop" ||
    value.hook_event_name === "afterAgentResponse"
  )
    return {
      ...base,
      hook_event_name: "Stop",
      stop_hook_active: false,
      ...(text(value.text) ? { last_assistant_message: value.text } : {}),
    };
  return null;
}

/** Text-less afterAgentResponse: the later stop carries the answer, so nothing is recorded now. */
export const cursorIgnored = (value: unknown) =>
  object(value) &&
  value.hook_event_name === "afterAgentResponse" &&
  !text(value.text);

/** Schema-valid pass responses; inactive and failed launches answer with these too. */
export function cursorPass(action: string): Record<string, unknown> {
  if (action === "guard") return { permission: "allow" };
  if (action === "prompt") return { continue: true };
  return {};
}

export function cursorOutput(
  action: string,
  result: { status: number | null; stdout: string; stderr: string },
): Record<string, unknown> {
  const reason = result.stderr.trim();
  if (result.status === 2) {
    if (action === "guard") return { permission: "deny", user_message: reason };
    if (action === "prompt") return { continue: false, user_message: reason };
  }
  if (action === "session" && result.status === 0 && result.stdout.trim())
    return { additional_context: result.stdout.trim() };
  return cursorPass(action);
}
