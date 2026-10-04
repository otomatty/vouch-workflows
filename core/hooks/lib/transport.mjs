// Native Cursor transport only; workflow decisions stay in shared product hooks.
import { resolve } from "node:path";

/** @param {unknown} value @returns {value is Record<string,unknown>} */
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const text = (value) => typeof value === "string" && value.length > 0;

/** Documented shapes; synthetic adapter tests are distinct from captured native fixtures.
 * @param {unknown} value @param {string} root @returns {Record<string,unknown>|null} */
export function cursorInput(value, root) {
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
    const names = /** @type {Record<string,string>} */ ({
      Write: "Write",
      write: "Write",
      write_file: "Write",
      Edit: "Edit",
      StrReplace: "Edit",
      str_replace: "Edit",
      edit_file: "Edit",
      Delete: "Delete",
      delete_file: "Delete",
      delete: "Delete",
      Bash: "Bash",
      Shell: "Bash",
      shell: "Bash",
      run_terminal_cmd: "Bash",
      apply_patch: "apply_patch",
    });
    const input = { ...value.tool_input };
    if (!Object.hasOwn(input, "file_path") && text(input.path))
      input.file_path = input.path;
    const tool = names[value.tool_name] ?? value.tool_name;
    return {
      ...base,
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
    (value.hook_event_name === "afterAgentResponse" && text(value.text))
  )
    return {
      ...base,
      hook_event_name: "Stop",
      stop_hook_active: false,
      ...(text(value.text) ? { last_assistant_message: value.text } : {}),
    };
  return null;
}

/** @param {string} action @param {{status:number|null,stdout:string,stderr:string}} result */
export function cursorOutput(action, result) {
  const reason = result.stderr.trim();
  if (action === "guard")
    return result.status === 2
      ? { permission: "deny", user_message: reason }
      : { permission: "allow" };
  if (action === "prompt")
    return result.status === 2
      ? { continue: false, user_message: reason }
      : { continue: true };
  if (action === "session" && result.status === 0 && result.stdout.trim())
    return { additional_context: result.stdout.trim() };
  return {};
}
