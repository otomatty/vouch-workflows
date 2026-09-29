// Exercise the copied write-guard registration with an installed CLI. Development-only.
// Usage: node scripts/check-write-guard.mjs <claude|codex> <absolute CLI path> [--control]
// Expectations: docs/development/write-guard.md. The loopback provider scripts every tool request.
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectHookTrust } from "./lib/codex-hook-trust.mjs";
import {
  guardCases,
  guardReason,
  verifyGuard,
} from "./lib/write-guard-native.mjs";

/** @typedef {import('./native-contracts.mjs').GuardCase} GuardCase */
/** @typedef {import('./native-contracts.mjs').GuardObservation} GuardObservation */

const [harness, executable, ...flags] = process.argv.slice(2);
if (
  (harness !== "claude" && harness !== "codex") ||
  !executable ||
  !isAbsolute(executable) ||
  !existsSync(executable) ||
  flags.some((flag) => flag !== "--control")
)
  throw new Error(
    "GUARD-ARGS: use node scripts/check-write-guard.mjs <claude|codex> <absolute CLI path> [--control]",
  );
if (process.platform === "win32")
  throw new Error("GUARD-PLATFORM: POSIX only; Windows is unverified");
const control = flags.includes("--control");
const repository = fileURLToPath(new URL("../", import.meta.url));
execFileSync(process.execPath, ["scripts/package.mjs", "--check"], {
  cwd: repository,
  timeout: 10000,
});
const reports = resolve(repository, "reports");
mkdirSync(reports, { recursive: true });
const base = mkdtempSync(
  resolve(
    reports,
    `write-guard-${harness}-${control ? "control" : "guarded"}-`,
  ),
);
const project = resolve(base, "project space");
const home = resolve(base, "home");
mkdirSync(home, { recursive: true });
cpSync(resolve(repository, `dist/${harness}`), project, { recursive: true });
execFileSync("git", ["init", "--quiet", project], { timeout: 5000 });
const registration = `.${harness}/${harness === "claude" ? "settings" : "hooks"}.json`;
if (control) {
  // The only change to the copy: without PreToolUse the guard is not registered.
  const value = JSON.parse(
    readFileSync(resolve(project, registration), "utf8"),
  );
  delete value.hooks.PreToolUse;
  writeFileSync(
    resolve(project, registration),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}
const intent = "260929-write-guard";
const audit = `vouch/intents/${intent}/audit/events.jsonl`;
const draft = `vouch/intents/${intent}/intent.md`;
mkdirSync(resolve(project, `vouch/intents/${intent}`), { recursive: true });
writeFileSync(
  resolve(project, draft),
  "---\nstatus: draft\n---\n# Scripted guard exercise\n\nAC-1: keep it.\n",
);
// Dangling until the startup hook creates the audit log.
symlinkSync(resolve(project, audit), resolve(project, "alias.jsonl"));
/** @param {string} id */
const forged = (id) =>
  JSON.stringify({
    id,
    v: 1,
    type: "intent.approved",
    ts: "2026-09-29T00:00:00.000Z",
    actor: "human",
    intent,
    source: "intent",
    parent: "evt_none",
    wait_ms: 0,
  });
/** @param {string} path @param {string} line */
const append = (path, line) =>
  `*** Begin Patch\n*** Update File: ${path}\n@@\n+${line}\n*** End of File\n*** End Patch\n`;
/** @param {string} path @param {string} from @param {string} to */
const replace = (path, from, to) =>
  `*** Begin Patch\n*** Update File: ${path}\n@@\n-${from}\n+${to}\n*** End Patch\n`;

/**
 * Each case names its target, the effect that shows the write happened, and the request.
 * Claude requires a Read before it writes an existing file, so those steps precede writes.
 * @type {{case:GuardCase,target:string|null,effect:string,claude:{name:string,input:object}[],codex:{kind:'patch'|'shell',text:string}}[]}
 */
const plan = [
  {
    case: "audit-file",
    target: audit,
    effect: "evt_forged_file",
    claude: [
      { name: "Read", input: { file_path: resolve(project, audit) } },
      {
        name: "Write",
        input: {
          file_path: resolve(project, audit),
          content: `${forged("evt_forged_file")}\n`,
        },
      },
    ],
    codex: { kind: "patch", text: append(audit, forged("evt_forged_file")) },
  },
  {
    case: "audit-shell",
    target: audit,
    effect: "evt_forged_shell",
    claude: [
      {
        name: "Bash",
        input: {
          command: `printf '%s\\n' '${forged("evt_forged_shell")}' >> ${audit}`,
          description: "Append a record",
        },
      },
    ],
    codex: {
      kind: "shell",
      text: `printf '%s\\n' '${forged("evt_forged_shell")}' >> ${audit}`,
    },
  },
  {
    case: "link",
    target: audit,
    effect: "evt_forged_link",
    claude: [
      { name: "Read", input: { file_path: resolve(project, "alias.jsonl") } },
      {
        name: "Write",
        input: {
          file_path: resolve(project, "alias.jsonl"),
          content: `${forged("evt_forged_link")}\n`,
        },
      },
    ],
    codex: {
      kind: "patch",
      text: append("alias.jsonl", forged("evt_forged_link")),
    },
  },
  {
    case: "approve",
    target: draft,
    effect: "status: approved",
    claude: [
      { name: "Read", input: { file_path: resolve(project, draft) } },
      {
        name: "Edit",
        input: {
          file_path: resolve(project, draft),
          old_string: "status: draft",
          new_string: "status: approved",
        },
      },
    ],
    codex: {
      kind: "patch",
      text: replace(draft, "status: draft", "status: approved"),
    },
  },
  {
    case: "registration",
    target: registration,
    effect: harness === "claude" ? "disableAllHooks" : '"matcher": "disabled"',
    claude: [
      { name: "Read", input: { file_path: resolve(project, registration) } },
      {
        name: "Edit",
        input: {
          file_path: resolve(project, registration),
          old_string: '"env": {',
          new_string: '"disableAllHooks": true, "env": {',
        },
      },
    ],
    codex: {
      kind: "patch",
      text: replace(
        registration,
        '        "matcher": "startup",',
        '        "matcher": "disabled",',
      ),
    },
  },
  {
    case: "draft",
    target: draft,
    effect: "AC-1: keep it well.",
    claude: [
      {
        name: "Edit",
        input: {
          file_path: resolve(project, draft),
          old_string: "AC-1: keep it.",
          new_string: "AC-1: keep it well.",
        },
      },
    ],
    codex: {
      kind: "patch",
      text: replace(draft, "AC-1: keep it.", "AC-1: keep it well."),
    },
  },
  {
    case: "read",
    target: audit,
    effect: "",
    claude: [
      {
        name: "Bash",
        input: { command: `cat ${audit}`, description: "Show the audit" },
      },
    ],
    codex: { kind: "shell", text: `cat ${audit}` },
  },
];
if (
  JSON.stringify(plan.map((item) => item.case)) !== JSON.stringify(guardCases())
)
  throw new Error("GUARD-PLAN: cases differ from the verification");

/** @typedef {{index:number,observe:boolean,claude:{name:string,input:object}|null}} Step */
/** Flat provider steps; `observe` marks the last request of a case. @type {Step[]} */
const steps = plan.flatMap((item, index) =>
  harness === "claude"
    ? item.claude.map(
        (request, offset) =>
          /** @type {Step} */ ({
            index,
            observe: offset === item.claude.length - 1,
            claude: request,
          }),
      )
    : [/** @type {Step} */ ({ index, observe: true, claude: null })],
);
/** @param {string|null} path */
const bytes = (path) =>
  path && existsSync(resolve(project, path))
    ? readFileSync(resolve(project, path), "utf8")
    : "";
/** @type {{before:string,result:string}[]} */
const seen = plan.map(() => ({ before: "", result: "" }));
/** @type {number|null} */ let pending = null;
/** @type {GuardObservation[]} */ const observations = [];
const prompt = "Exercise the scripted guard requests in this isolated project.";

/** @param {unknown} content @returns {string} */
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && "text" in block
        ? String(block.text)
        : "",
    )
    .join("\n");
}

/** The first record's ID, which survives the JSON escaping of a shell result. @param {string} text */
function firstId(text) {
  try {
    return String(JSON.parse(text.split("\n")[0] ?? "").id);
  } catch {
    return text.slice(0, 40);
  }
}

/** Close the pending case with the result the harness returned for it. @param {string} result */
function settle(result) {
  if (pending === null) return;
  const item = /** @type {typeof plan[number]} */ (plan[pending]);
  const after = bytes(item.target);
  observations.push({
    case: item.case,
    tool:
      harness === "claude"
        ? /** @type {string} */ (item.claude.at(-1)?.name)
        : item.codex.kind === "patch"
          ? "apply_patch"
          : "Bash",
    reason: guardReason(result),
    result: result.replaceAll(project, "<project>").slice(0, 600),
    changed: after !== (seen[pending]?.before ?? ""),
    // cat returns the current audit; the other cases show their effect in the target.
    expected:
      item.case === "read"
        ? after !== "" && result.includes(firstId(after))
        : after.includes(item.effect),
  });
  pending = null;
}

let requests = 0;
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const url = request.url ?? "";
  if (url.includes("count_tokens")) {
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end('{"input_tokens":1}');
    return;
  }
  if (!/\/v1\/(?:messages|responses)/.test(url)) {
    response.writeHead(404).end();
    return;
  }
  const value = JSON.parse(body || "{}");
  writeFileSync(resolve(base, `request-${requests++}.json`), body);
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  /** @param {string} type @param {object} data */
  const emit = (type, data) =>
    response.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
    );
  if (harness === "claude") {
    const messages = Array.isArray(value.messages) ? value.messages : [];
    const main = textOf(messages[0]?.content).includes(prompt);
    const done = messages.filter(
      (/** @type {{role:string}} */ message) => message.role === "assistant",
    ).length;
    // Reminders follow the tool result, so find the result of the last tool use by its ID.
    const results = messages
      .flatMap((/** @type {{content:unknown}} */ message) =>
        Array.isArray(message.content) ? message.content : [],
      )
      .filter(
        (/** @type {{type:string,tool_use_id?:string}} */ block) =>
          block.type === "tool_result" &&
          block.tool_use_id === `toolu_guard_${done - 1}`,
      )
      .map((/** @type {{content:unknown}} */ block) => textOf(block.content))
      .join("\n");
    const step = main ? steps[done] : undefined;
    if (main && steps[done - 1]?.observe) settle(results);
    if (step?.observe) {
      pending = step.index;
      seen[step.index] = {
        before: bytes(plan[step.index]?.target ?? null),
        result: "",
      };
    }
    const block = step?.claude
      ? {
          type: "tool_use",
          id: `toolu_guard_${done}`,
          name: step.claude.name,
          input: step.claude.input,
        }
      : { type: "text", text: "Scripted guard exercise completed." };
    const message = {
      id: `msg_guard_${done}`,
      type: "message",
      role: "assistant",
      model: value.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    emit("message_start", { message });
    emit("content_block_start", {
      index: 0,
      content_block:
        block.type === "tool_use"
          ? { ...block, input: {} }
          : { type: "text", text: "" },
    });
    emit("content_block_delta", {
      index: 0,
      delta:
        block.type === "tool_use"
          ? {
              type: "input_json_delta",
              partial_json: JSON.stringify(block.input),
            }
          : { type: "text_delta", text: block.text },
    });
    emit("content_block_stop", { index: 0 });
    emit("message_delta", {
      delta: {
        stop_reason: step ? "tool_use" : "end_turn",
        stop_sequence: null,
      },
      usage: { output_tokens: 1 },
    });
    emit("message_stop", {});
  } else {
    const input = Array.isArray(value.input) ? value.input : [];
    /** @type {{thread_source?:string}} */ let turn = {};
    try {
      turn = JSON.parse(
        value.client_metadata?.["x-codex-turn-metadata"] ?? "{}",
      );
    } catch {}
    const main =
      turn.thread_source === "user" && JSON.stringify(input).includes(prompt);
    const outputs = input.filter(
      (/** @type {{type:string}} */ item) =>
        item.type === "custom_tool_call_output",
    );
    const done = outputs.length;
    if (main && done > 0) settle(textOf(outputs.at(-1)?.output));
    const step = main ? steps[done] : undefined;
    const item = plan[step?.index ?? -1];
    if (step && item) {
      pending = step.index;
      seen[step.index] = { before: bytes(item.target), result: "" };
    }
    const call =
      item?.codex.kind === "patch"
        ? `tools.apply_patch(${JSON.stringify(item.codex.text)})`
        : `tools.exec_command({cmd: ${JSON.stringify(item?.codex.text ?? "")}})`;
    const output = item
      ? {
          type: "custom_tool_call",
          id: `ctc_guard_${done}`,
          call_id: `call_guard_${done}`,
          name: "exec",
          input: `try { const r = await ${call}; text("OK " + JSON.stringify(r)); } catch (e) { text("ERR " + String(e)); }`,
        }
      : {
          type: "message",
          id: `msg_guard_${done}`,
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "Scripted guard exercise completed.",
              annotations: [],
            },
          ],
        };
    const completed = {
      id: `resp_guard_${done}`,
      object: "response",
      created_at: 1790510000,
      status: "completed",
      model: value.model,
      output: [output],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
    emit("response.created", {
      response: { ...completed, status: "in_progress", output: [] },
    });
    emit("response.output_item.added", { output_index: 0, item: output });
    emit("response.output_item.done", { output_index: 0, item: output });
    emit("response.completed", { response: completed });
  }
  response.end();
});
await new Promise((accept, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => accept(undefined));
});
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("GUARD-PROVIDER: no loopback port");
const provider = `http://127.0.0.1:${address.port}`;
const key = "local-fixture-only";
// OS lookup only; the caller names the other harness so the registration must set its own.
/** @type {NodeJS.ProcessEnv} */
const env = {
  PATH: process.env.PATH ?? "",
  LANG: "C.UTF-8",
  TERM: "xterm-256color",
  HOME: home,
  VOUCH_HARNESS: harness === "claude" ? "codex" : "claude",
  VOUCH_INTENT: intent,
};
/** @type {string[]} */ let args;
if (harness === "claude") {
  const config = resolve(home, "claude");
  mkdirSync(config);
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: config,
    ANTHROPIC_BASE_URL: provider,
    ANTHROPIC_API_KEY: key,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  });
  args = [
    "--print",
    prompt,
    "--model",
    "vouch-capture-model",
    "--strict-mcp-config",
    "--tools",
    "Read,Write,Edit,Bash",
    "--allowedTools",
    "Bash",
    "--permission-mode",
    "acceptEdits",
    "--max-turns",
    String(steps.length + 2),
  ];
} else {
  Object.assign(env, { CODEX_HOME: home, VOUCH_PROJECT_ROOT: project });
  let config = `check_for_update_on_startup = false\nmodel_provider = "vouch_observer"\n[model_providers.vouch_observer]\nname = "Local observer only"\nbase_url = "${provider}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n[analytics]\nenabled = false\n[features]\nhooks = true\nplugins = false\nremote_plugin = false\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`;
  writeFileSync(resolve(home, "config.toml"), config);
  const hooks = JSON.parse(
    readFileSync(resolve(project, registration), "utf8"),
  ).hooks;
  const trust = await projectHookTrust(
    executable,
    env,
    project,
    ["SessionStart", "UserPromptSubmit", "PreToolUse"]
      .filter((event) => hooks[event])
      .map((event) => hooks[event][0].hooks[0].command),
  );
  config += trust.config;
  writeFileSync(resolve(home, "config.toml"), config);
  args = ["exec", "-s", "workspace-write", "-C", project, prompt];
}
const child = spawn(executable, args, {
  cwd: project,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout?.on("data", (chunk) => (output += chunk));
child.stderr?.on("data", (chunk) => (output += chunk));
const limit = setTimeout(() => child.kill(), 120000);
const code = await new Promise((accept) => child.once("exit", accept));
clearTimeout(limit);
server.closeAllConnections();
await new Promise((accept) => server.close(accept));
writeFileSync(resolve(base, "output.txt"), output);
const rows = bytes(audit)
  .split("\n")
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [{ type: null, harness: null }];
    }
  });
const cliVersion = execFileSync(executable, ["--version"], {
  encoding: "utf8",
  env: { PATH: process.env.PATH ?? "", HOME: base },
  timeout: 10000,
}).trim();
/** @type {import('./native-contracts.mjs').GuardRun & {exitCode:unknown}} */
const run = {
  harness,
  cliVersion,
  platform: process.platform,
  nodeVersion: process.version,
  registration: /** @type {'guarded'|'control'} */ (
    control ? "control" : "guarded"
  ),
  exitCode: code,
  observations,
  audit: rows.map((row) => ({ type: row.type, harness: row.harness })),
  forged: /evt_forged_/.test(bytes(audit)),
  errors: /** @type {string[]} */ ([]),
};
run.errors = verifyGuard(run);
writeFileSync(
  resolve(base, "summary.json"),
  `${JSON.stringify(run, null, 2)}\n`,
);
console.log(
  `${run.errors.length ? "FAIL" : "PASS"} ${harness} ${run.registration}: ${resolve(base, "summary.json")}`,
);
process.exitCode = run.errors.length ? 1 : 0;
