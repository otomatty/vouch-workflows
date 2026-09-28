// Capture Claude Code hook stdin from an installed CLI. Development-only; never distributed.
// Usage: node tests/fixtures/captures/linux/claude.mjs <absolute claude path> <new output directory> <print|tty>
// The loopback provider scripts tool requests; the recorded stdin is produced by the CLI itself.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, resolve } from "node:path";

const [cli, out, mode] = process.argv.slice(2);
if (!cli || !isAbsolute(cli) || !out || !["print", "tty"].includes(mode ?? ""))
  throw new Error("usage: claude.mjs <absolute cli> <new dir> <print|tty>");
const base = resolve(out);
if (existsSync(base)) throw new Error(`capture exists: ${base}`);
const project = resolve(base, "project");
const config = resolve(base, "config");
const home = resolve(base, "home");
for (const dir of [project, config, home]) mkdirSync(dir, { recursive: true });
execFileSync("git", ["init", "--quiet", project]);
const raw = resolve(base, "raw.jsonl");
const recorder = resolve(base, "record.mjs");
// Records exactly what the CLI wrote to stdin; always exits 0 so the session proceeds.
writeFileSync(
  recorder,
  "import {appendFileSync} from 'node:fs';let text='';for await (const c of process.stdin) text+=c;appendFileSync(process.argv[2],JSON.stringify(JSON.parse(text))+'\\n');\n",
);
const events = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
];
const hook = { type: "command", command: "node", args: [recorder, raw] };
writeFileSync(
  resolve(base, "settings.json"),
  JSON.stringify(
    {
      permissions: {
        allow: ["Write", "Edit", "Bash(echo vouch-capture)", "Bash(false)", "Agent", "AskUserQuestion"],
      },
      hooks: Object.fromEntries(events.map((name) => [name, [{ hooks: [hook] }]])),
    },
    null,
    2,
  ),
);
const key = "local-fixture-only";
if (mode === "tty")
  // Isolated first-run state only: onboarding done, this project trusted, the fixture key accepted.
  writeFileSync(
    resolve(config, ".claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: "dark",
      customApiKeyResponses: { approved: [key.slice(-20)], rejected: [] },
      projects: { [project]: { hasTrustDialogAccepted: true } },
    }),
  );
const target = resolve(project, "intent.md");
const subagentMarker = "VOUCH-SUBAGENT capture: reply with one sentence and use no tools.";
const question = {
  questions: [
    {
      question: "Which capture option applies?",
      header: "Capture",
      multiSelect: false,
      options: [
        { label: "Option A", description: "Fixture answer A" },
        { label: "Option B", description: "Fixture answer B" },
      ],
    },
  ],
};
/** Main-loop steps, chosen by the number of assistant turns already in the request. */
const steps =
  mode === "print"
    ? [
        { name: "Write", input: { file_path: target, content: "---\nstatus: draft\n---\n# Capture only\n" } },
        { name: "Edit", input: { file_path: target, old_string: "# Capture only", new_string: "# Capture only (edited)" } },
        { name: "Bash", input: { command: "echo vouch-capture", description: "Print a constant" } },
        { name: "Bash", input: { command: "false", description: "Exit nonzero" } },
        { name: "Agent", input: { description: "Capture subagent", prompt: subagentMarker, subagent_type: "general-purpose" } },
      ]
    : [{ name: "AskUserQuestion", input: question }];
/** @type {object[]} */
const log = [];
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const value = JSON.parse(body || "{}");
  if (req.url?.includes("count_tokens")) {
    res.setHeader("Content-Type", "application/json");
    res.end('{"input_tokens":100}');
    return;
  }
  if (!req.url?.startsWith("/v1/messages")) {
    log.push({ url: req.url, status: 404 });
    res.writeHead(404).end();
    return;
  }
  const tools = (value.tools ?? []).map((/** @type {{name:string}} */ t) => t.name);
  const first = JSON.stringify(value.messages?.[0]?.content ?? "");
  const turns = (value.messages ?? []).filter((/** @type {{role:string}} */ m) => m.role === "assistant").length;
  const role = first.includes("VOUCH-SUBAGENT") ? "subagent" : tools.includes(steps[0]?.name) ? "main" : "auxiliary";
  // Resumed sessions already hold every scripted turn, so they only receive text.
  const step = role === "main" ? steps[turns] : undefined;
  log.push({ url: req.url, role, turns, tools, step: step?.name ?? null });
  const content = step
    ? [{ type: "tool_use", id: `toolu_vouch_capture_${turns}`, name: step.name, input: step.input }]
    : [{ type: "text", text: role === "auxiliary" ? "Capture summary." : "Local fixture exercise completed." }];
  const msg = {
    id: `msg_capture_${log.length}`,
    type: "message",
    role: "assistant",
    model: value.model,
    content,
    stop_reason: step ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
  if (!value.stream) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(msg));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (/** @type {string} */ type, /** @type {object} */ data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  emit("message_start", { message: { ...msg, content: [], stop_reason: null } });
  const block = content[0];
  if (block?.type === "tool_use") {
    emit("content_block_start", { index: 0, content_block: { ...block, input: {} } });
    emit("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
  } else {
    emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: block?.text ?? "" } });
  }
  emit("content_block_stop", { index: 0 });
  emit("message_delta", { delta: { stop_reason: msg.stop_reason, stop_sequence: null }, usage: { output_tokens: 20 } });
  emit("message_stop", {});
  res.end();
});
await new Promise((accept) => server.listen(0, "127.0.0.1", () => accept(undefined)));
const address = server.address();
if (!address || typeof address === "string") throw new Error("no loopback port");
// Only OS lookup variables are inherited; credentials, proxies and user configuration are not.
const env = {
  PATH: process.env.PATH ?? "",
  LANG: "C.UTF-8",
  HOME: home,
  TERM: "xterm-256color",
  CLAUDE_CONFIG_DIR: config,
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
  ANTHROPIC_API_KEY: key,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
};
// A placeholder model name keeps the CLI's default model identifier out of the fixtures;
// the loopback provider does not check it.
const common = ["--model", "vouch-capture-model", "--restricted", "--strict-mcp-config", "--settings", resolve(base, "settings.json")];
const rows = () =>
  existsSync(raw) ? readFileSync(raw, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
const quote = (/** @type {string} */ a) => `'${a.replaceAll("'", "'\\''")}'`;
/** @type {object[]} */
const runs = [];
/**
 * @param {string[]} args
 * @param {{tty?:boolean,answer?:string,until?:string}} [how]
 * `answer` is typed after the question's PreToolUse; `until` ends the TUI once that event is recorded.
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
  let answered = false;
  let stopped = false;
  const seen = (/** @type {(row:{hook_event_name:string,tool_name?:string}) => boolean} */ match) => rows().slice(before).some(match);
  const watch = setInterval(() => {
    if (how.answer && !answered && seen((row) => row.hook_event_name === "PreToolUse" && row.tool_name === "AskUserQuestion")) {
      answered = true;
      // Keys and Enter go in separate writes after the question renders.
      setTimeout(() => child.stdin?.write(how.answer ?? ""), 1500);
      setTimeout(() => child.stdin?.write("\r"), 2500);
    }
    if (how.until && seen((row) => row.hook_event_name === how.until)) {
      stopped = true;
      child.kill();
    }
  }, 500);
  const timer = setTimeout(() => child.kill(), 60000);
  const code = await new Promise((accept) => child.on("exit", accept));
  clearInterval(watch);
  clearTimeout(timer);
  runs.push({ args, tty: !!how.tty, code, answered, stoppedByController: stopped, stdout, stderr, captured: rows().slice(before).map((row) => row.hook_event_name) });
}
const version = execFileSync(cli, ["--version"], { env, encoding: "utf8" }).trim();
if (mode === "print") {
  await launch([
    "--print",
    "Exercise the capture tools in the isolated fixture project.",
    ...common,
    // --restricted drops command tools unless --tools names them.
    "--tools",
    "Write,Edit,Bash,Agent",
    "--permission-mode",
    "acceptEdits",
    "--max-turns",
    "8",
  ]);
  const session = rows().find((row) => row.hook_event_name === "SessionStart")?.session_id;
  if (session) {
    await launch(["--print", "Resume capture.", "--resume", session, ...common, "--max-turns", "1"]);
    await launch(["--print", "/compact", "--resume", session, ...common, "--max-turns", "1"]);
  }
} else {
  await launch(["Ask the capture question in the isolated fixture project.", ...common, "--tools", "AskUserQuestion"], {
    tty: true,
    answer: "1",
    until: "Stop",
  });
}
server.close();
writeFileSync(
  resolve(base, "summary.json"),
  `${JSON.stringify({ version, mode, platform: process.platform, node: process.version, runs, requests: log, captured: rows().map((row) => row.hook_event_name) }, null, 2)}\n`,
);
console.log({ version, mode, captured: rows().map((row) => `${row.hook_event_name}${row.tool_name ? `.${row.tool_name}` : ""}${row.source ? `.${row.source}` : ""}${row.trigger ? `.${row.trigger}` : ""}`) });
