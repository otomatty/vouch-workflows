// Capture Codex hook stdin from an installed CLI. Development-only; never distributed.
// Usage: node tests/fixtures/captures/linux/codex.mjs <absolute codex path> <new output directory> <exec|tty|plan>
// Hooks are trusted by their listed hash only; no trust or sandbox bypass flag is used.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";

const [cli, out, mode] = process.argv.slice(2);
if (!cli || !isAbsolute(cli) || !out || !["exec", "tty", "plan"].includes(mode ?? ""))
  throw new Error("usage: codex.mjs <absolute cli> <new dir> <exec|tty|plan>");
const base = resolve(out);
if (existsSync(base)) throw new Error(`capture exists: ${base}`);
const project = resolve(base, "project");
const home = resolve(base, "home");
for (const dir of [project, home]) mkdirSync(dir, { recursive: true });
execFileSync("git", ["init", "--quiet", project]);
const raw = resolve(base, "raw.jsonl");
const recorder = resolve(base, "record.mjs");
writeFileSync(
  recorder,
  "import {appendFileSync} from 'node:fs';let text='';for await (const c of process.stdin) text+=c;appendFileSync(process.argv[2],JSON.stringify(JSON.parse(text))+'\\n');\n",
);
const command = `node ${JSON.stringify(recorder)} ${JSON.stringify(raw)}`;
const events = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
];
writeFileSync(
  resolve(home, "hooks.json"),
  JSON.stringify(
    { hooks: Object.fromEntries(events.map((name) => [name, [{ hooks: [{ type: "command", command }] }]])) },
    null,
    2,
  ),
);
const prompt = mode === "plan" ? "Ask the capture question in this fixture directory." : "Exercise the native tools once in this fixture directory.";
const patch = "*** Begin Patch\n*** Add File: capture.txt\n+Native tool fixture only.\n*** End Patch\n";
const subagent = "VOUCH-SUBAGENT capture: reply with one sentence and use no tools.";
/**
 * Scripted calls, chosen by how many tool outputs the root request already holds.
 * 0.153.4 exposes nested tools through the code-mode `exec` custom tool.
 * @type {({kind:'custom',name:string,input:string}|{kind:'function',name:string,namespace:string,args:object})[]}
 */
const tools = [
  { kind: "custom", name: "exec", input: `await tools.apply_patch(${JSON.stringify(patch)});\ntext("patched");` },
  { kind: "custom", name: "exec", input: 'const r = await tools.exec_command({cmd: "echo vouch-capture"});\ntext(r.output);' },
  { kind: "custom", name: "exec", input: 'const r = await tools.exec_command({cmd: "false"});\ntext(String(r.exit_code));' },
  { kind: "function", name: "spawn_agent", namespace: "collaboration", args: { task_name: "capture_sub", fork_turns: "none", message: subagent } },
  { kind: "function", name: "wait_agent", namespace: "collaboration", args: { timeout_ms: 10000 } },
];
/** @type {typeof tools[number]} */
const question = {
  kind: "function",
  name: "request_user_input",
  namespace: "functions",
  args: {
    questions: [
      {
        id: "capture_option",
        header: "Capture",
        question: "Which capture option applies?",
        options: [
          { label: "Option A (Recommended)", description: "Fixture answer A" },
          { label: "Option B", description: "Fixture answer B" },
        ],
      },
    ],
  },
};
// Plan mode only asks the question; the other modes also try it in Default mode.
const steps = mode === "plan" ? [question] : [...tools, question];
/** @type {object[]} */
const log = [];
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!req.url?.endsWith("/responses")) {
    log.push({ url: req.url, status: 404 });
    res.writeHead(404).end();
    return;
  }
  const value = JSON.parse(body);
  writeFileSync(resolve(base, `request-${log.length}.json`), body);
  const input = Array.isArray(value.input) ? value.input : [];
  const done = input.filter((/** @type {{type:string}} */ item) => /_call_output$/.test(item.type)).length;
  /** @type {{agent_name?:string,thread_source?:string}} */
  let turn = {};
  try {
    turn = JSON.parse(value.client_metadata?.["x-codex-turn-metadata"] ?? "{}");
  } catch {}
  const agent = turn.agent_name ?? "";
  // System threads such as TUI title generation (thread_source: system) get text only.
  const root = agent === "/root" && turn.thread_source === "user" && JSON.stringify(input).includes(prompt);
  const scripted = root ? steps[done] : undefined;
  log.push({ url: req.url, agent, source: turn.thread_source ?? null, done, step: scripted?.name ?? null });
  const id = `call_vouch_capture_${done}`;
  const item = !scripted
    ? { type: "message", id: `msg_capture_${log.length}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Native tool capture completed.", annotations: [] }] }
    : scripted.kind === "custom"
      ? { type: "custom_tool_call", id: `ctc_${id}`, call_id: id, name: scripted.name, input: scripted.input }
      : { type: "function_call", id: `fc_${id}`, call_id: id, name: scripted.name, namespace: scripted.namespace, arguments: JSON.stringify(scripted.args) };
  const response = { id: `resp_capture_${log.length}`, object: "response", created_at: 1790510000, status: "completed", model: value.model, output: [item], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } };
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (/** @type {string} */ type, /** @type {object} */ data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  emit("response.created", { response: { ...response, status: "in_progress", output: [] } });
  emit("response.output_item.added", { output_index: 0, item });
  emit("response.output_item.done", { output_index: 0, item });
  emit("response.completed", { response });
  res.end();
});
await new Promise((accept) => server.listen(0, "127.0.0.1", () => accept(undefined)));
const address = server.address();
if (!address || typeof address === "string") throw new Error("no loopback port");
let config = `check_for_update_on_startup = false\nmodel_provider = "capture"\n[model_providers.capture]\nname = "Local fixed fixture provider"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n[analytics]\nenabled = false\n[features]\nhooks = true\nplugins = false\nremote_plugin = false\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`;
writeFileSync(resolve(home, "config.toml"), config);
// Only OS lookup variables are inherited; credentials, proxies and user configuration are not.
const env = { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", HOME: home, CODEX_HOME: home, TERM: "xterm-256color" };
const version = execFileSync(cli, ["--version"], { env, encoding: "utf8" }).trim();
// Trust exactly the listed recorder hashes in the isolated home.
const rpc = spawn(cli, ["app-server", "--listen", "stdio://"], { cwd: project, env, stdio: ["pipe", "pipe", "pipe"] });
let sequence = 0;
/** @type {Map<number,(value:unknown)=>void>} */
const pending = new Map();
createInterface({ input: rpc.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
const send = (/** @type {string} */ method, /** @type {object} */ params) =>
  new Promise((accept) => {
    const id = ++sequence;
    pending.set(id, accept);
    rpc.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
await send("initialize", { clientInfo: { name: "fixture_capture", version: "0.0.0" }, capabilities: { experimentalApi: true } });
rpc.stdin.write('{"method":"initialized","params":{}}\n');
const listed = await send("hooks/list", { cwds: [project] });
writeFileSync(resolve(base, "hooks-list.json"), `${JSON.stringify(listed, null, 2)}\n`);
rpc.stdin.end();
rpc.kill();
/** @param {unknown} value */
const collect = (value) => {
  if (!value || typeof value !== "object") return;
  if ("key" in value && "currentHash" in value && "command" in value && value.command === command)
    config += `\n[hooks.state.${JSON.stringify(value.key)}]\nenabled = true\ntrusted_hash = ${JSON.stringify(value.currentHash)}\n`;
  for (const child of Object.values(value)) collect(child);
};
collect(listed);
writeFileSync(resolve(home, "config.toml"), config);
const rows = () => (existsSync(raw) ? readFileSync(raw, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []);
const quote = (/** @type {string} */ a) => `'${a.replaceAll("'", "'\\''")}'`;
/** @type {object[]} */
const runs = [];
/**
 * @param {string[]} args
 * @param {{tty?:boolean,actions?:{after:"start"|((row:{hook_event_name:string,tool_name?:string})=>boolean),keys:string[]}[],until?:string}} [how]
 * Each action types its keys once a matching event is recorded; `until` ends the TUI once that event is recorded.
 */
async function launch(args, how = {}) {
  // The interactive TUI needs a terminal; util-linux script(1) supplies a sized pseudo terminal.
  const child = how.tty
    ? spawn("script", ["-qfec", `stty cols 120 rows 40; exec ${[cli, ...args].map(quote).join(" ")}`, resolve(base, `tty-${runs.length}.log`)], { cwd: project, env, stdio: ["pipe", "pipe", "pipe"] })
    : spawn(/** @type {string} */ (cli), args, { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (x) => (stdout += x));
  child.stderr?.on("data", (x) => (stderr += x));
  const before = rows().length;
  /** @type {number[]} */
  const typed = [];
  let stopped = false;
  const watch = setInterval(() => {
    const recent = rows().slice(before);
    (how.actions ?? []).forEach((action, index) => {
      const after = action.after;
      if (typed.includes(index) || (after !== "start" && !recent.some(after))) return;
      typed.push(index);
      // Keys go in separate writes after the screen settles; one chunk is treated as a paste.
      action.keys.forEach((keys, offset) => setTimeout(() => child.stdin?.write(keys), 2000 + offset * 1000));
    });
    if (how.until && recent.some((row) => row.hook_event_name === how.until)) {
      stopped = true;
      child.kill();
    }
  }, 500);
  const timer = setTimeout(() => child.kill(), 90000);
  const code = await new Promise((accept) => child.on("exit", accept));
  clearInterval(watch);
  clearTimeout(timer);
  runs.push({ args, tty: !!how.tty, code, typed, stoppedByController: stopped, stdout, stderr, captured: rows().slice(before).map((row) => row.hook_event_name) });
}
if (mode === "exec") {
  await launch(["exec", "-s", "workspace-write", "-C", project, prompt]);
  const session = rows().find((row) => row.hook_event_name === "SessionStart")?.session_id;
  if (session) await launch(["exec", "resume", session, "Resume capture."]);
} else if (mode === "plan") {
  // Shift+Tab switches the TUI collaboration mode to Plan before the prompt is typed.
  await launch(["--no-alt-screen", "-a", "never", "-s", "workspace-write", "-C", project], {
    tty: true,
    actions: [
      { after: "start", keys: ["", "\u001b[Z", prompt, "\r"] },
      // Answer with the first option once PreToolUse shows the question was accepted.
      { after: (row) => row.hook_event_name === "PreToolUse" && row.tool_name === "request_user_input", keys: ["1", "\r"] },
    ],
    until: "Stop",
  });
} else {
  await launch(["--no-alt-screen", "-a", "never", "-s", "workspace-write", "-C", project, prompt], {
    tty: true,
    // Default mode rejects the question without showing it, so only /compact is typed.
    actions: [{ after: (row) => row.hook_event_name === "Stop", keys: ["/compact", "\r"] }],
    until: "PostCompact",
  });
}
server.close();
writeFileSync(
  resolve(base, "summary.json"),
  `${JSON.stringify({ version, mode, platform: process.platform, node: process.version, runs, requests: log, captured: rows().map((row) => row.hook_event_name), created: existsSync(resolve(project, "capture.txt")) }, null, 2)}\n`,
);
console.log({ version, mode, captured: rows().map((row) => `${row.hook_event_name}${row.tool_name ? `.${row.tool_name}` : ""}${row.source ? `.${row.source}` : ""}${row.trigger ? `.${row.trigger}` : ""}`) });
