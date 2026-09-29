import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectHookTrust } from "./lib/codex-hook-trust.mjs";
import {
  promptCarried,
  propagationCases,
  stripTerminal,
  verifyPropagation,
} from "./lib/propagation.mjs";

/** @typedef {import('./native-contracts.mjs').PropagationCase} PropagationCase */
/** @typedef {import('./native-contracts.mjs').PropagationObservation} PropagationObservation */

const [harness, executable, mode, ...extra] = process.argv.slice(2);
if (
  (harness !== "claude" && harness !== "codex") ||
  !executable ||
  !isAbsolute(executable) ||
  !existsSync(executable) ||
  (mode !== "noninteractive" && mode !== "interactive") ||
  extra.length
)
  throw new Error(
    "PROPAGATION-ARGS: use node scripts/check-hook-propagation.mjs <claude|codex> <absolute CLI path> <noninteractive|interactive>",
  );
// Registrations run through sh and the interactive exercise needs script(1).
if (process.platform === "win32")
  throw new Error("PROPAGATION-PLATFORM: POSIX only; Windows is unverified");
const interactive = mode === "interactive";
const cli = executable;
const repository = fileURLToPath(new URL("../", import.meta.url));
execFileSync(process.execPath, ["scripts/package.mjs", "--check"], {
  cwd: repository,
  timeout: 10000,
});
const reports = resolve(repository, "reports");
mkdirSync(reports, { recursive: true });
const base = mkdtempSync(resolve(reports, `propagation-${harness}-${mode}-`));
const intent = "260928-propagation";
const draft = "---\nstatus: draft\n---\n# Scripted propagation exercise\n";
const corrupt = "not json\n";
/** @type {Record<PropagationCase,string>} */
const prompts = {
  allow: "Reply with one short sentence.",
  open: "vouch review",
  invalid: "vouch approve not-a-gate",
  corrupt: "vouch review",
  "no-intent": "vouch review",
  "no-root": "vouch review",
};

/** Requests of the running case; the provider never produces tool calls. */
let current = { prompt: "", carried: 0, all: 0 };
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const url = request.url ?? "";
  current.all++;
  if (promptCarried(harness, url, body, current.prompt)) current.carried++;
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
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  /** @param {string} type @param {object} data */
  const emit = (type, data) =>
    response.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
    );
  const text = "Local observer reply.";
  if (harness === "codex") {
    const item = {
      type: "message",
      id: "msg_observer",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    };
    const done = {
      id: "resp_observer",
      object: "response",
      created_at: 1790510000,
      status: "completed",
      output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
    emit("response.created", {
      response: { ...done, status: "in_progress", output: [] },
    });
    emit("response.output_item.added", { output_index: 0, item });
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", { response: done });
  } else {
    const message = {
      id: "msg_observer",
      type: "message",
      role: "assistant",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    emit("message_start", { message });
    emit("content_block_start", {
      index: 0,
      content_block: { type: "text", text: "" },
    });
    emit("content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text },
    });
    emit("content_block_stop", { index: 0 });
    emit("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    });
    emit("message_stop", {});
  }
  response.end();
});
await new Promise((accept, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => accept(undefined));
});
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("PROPAGATION-PROVIDER: no loopback port");
const provider = `http://127.0.0.1:${address.port}`;
const key = "local-fixture-only";

/** @param {string} value */
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
/** @param {number} ms */
const pause = (ms) => new Promise((accept) => setTimeout(accept, ms));

/** @param {PropagationCase} kase @returns {Promise<PropagationObservation>} */
async function exercise(kase) {
  const dir = resolve(base, kase);
  const project = resolve(dir, "project space");
  const home = resolve(dir, "home");
  mkdirSync(home, { recursive: true });
  cpSync(resolve(repository, `dist/${harness}`), project, { recursive: true });
  execFileSync("git", ["init", "--quiet", project], { timeout: 5000 });
  const intentDir = resolve(project, "vouch/intents", intent);
  mkdirSync(intentDir, { recursive: true });
  writeFileSync(resolve(intentDir, "intent.md"), draft);
  const audit = resolve(intentDir, "audit/events.jsonl");
  if (kase === "corrupt") {
    mkdirSync(resolve(intentDir, "audit"));
    writeFileSync(audit, corrupt);
  }
  const prepared = existsSync(audit) ? readFileSync(audit) : null;
  // OS lookup only; the caller's VOUCH_HARNESS names the other harness to show the registration sets its own.
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    PATH: process.env.PATH ?? "",
    LANG: "C.UTF-8",
    TERM: "xterm-256color",
    HOME: home,
    VOUCH_HARNESS: harness === "claude" ? "codex" : "claude",
    ...(kase === "no-intent" ? {} : { VOUCH_INTENT: intent }),
  };
  if (harness === "claude") {
    const config = resolve(home, "claude");
    mkdirSync(config);
    Object.assign(env, {
      CLAUDE_CONFIG_DIR: config,
      ANTHROPIC_BASE_URL: provider,
      ANTHROPIC_API_KEY: key,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
    // Isolated first-run state only: onboarding done, this project trusted, the local key accepted.
    if (interactive)
      writeFileSync(
        resolve(config, ".claude.json"),
        JSON.stringify({
          hasCompletedOnboarding: true,
          theme: "dark",
          customApiKeyResponses: { approved: [key.slice(-20)], rejected: [] },
          projects: { [project]: { hasTrustDialogAccepted: true } },
        }),
      );
  } else {
    Object.assign(env, {
      CODEX_HOME: home,
      ...(kase === "no-root" ? {} : { VOUCH_PROJECT_ROOT: project }),
    });
    let config = `check_for_update_on_startup = false\nmodel_provider = "vouch_observer"\n[model_providers.vouch_observer]\nname = "Local observer only"\nbase_url = "${provider}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n[analytics]\nenabled = false\n[features]\nhooks = true\nplugins = false\nremote_plugin = false\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`;
    writeFileSync(resolve(home, "config.toml"), config);
    const registration = JSON.parse(
      readFileSync(resolve(project, ".codex/hooks.json"), "utf8"),
    );
    const trust = await projectHookTrust(
      cli,
      env,
      project,
      ["SessionStart", "UserPromptSubmit", "PreToolUse"].map(
        (event) => registration.hooks[event][0].hooks[0].command,
      ),
    );
    config += trust.config;
    writeFileSync(resolve(home, "config.toml"), config);
  }
  current = { prompt: prompts[kase], carried: 0, all: 0 };
  const args =
    harness === "claude"
      ? [prompts[kase], "--tools", "", "--strict-mcp-config"]
      : interactive
        ? ["--no-alt-screen", "-a", "never", "-s", "workspace-write"]
        : ["exec", "-s", "workspace-write"];
  if (harness === "codex") args.push("-C", project, prompts[kase]);
  if (harness === "claude" && !interactive) args.unshift("--print");
  const log = resolve(dir, "terminal.log");
  const child = interactive
    ? spawn(
        "script",
        [
          "-qfec",
          `stty cols 120 rows 40; exec ${[cli, ...args].map(quote).join(" ")}`,
          log,
        ],
        { cwd: project, env, stdio: ["pipe", "pipe", "pipe"] },
      )
    : spawn(cli, args, {
        cwd: project,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));
  const exited = new Promise((accept) => child.once("exit", accept));
  let terminated = false;
  if (interactive) {
    // The TUI never exits by itself: stop shortly after delivery or a visible hook outcome.
    const deadline = Date.now() + 45000;
    const settled = () =>
      current.carried > 0 ||
      /VOUCH-REVIEW-|VOUCH_PROJECT_ROOT/.test(
        existsSync(log) ? stripTerminal(readFileSync(log, "utf8")) : "",
      );
    while (!settled() && Date.now() < deadline) await pause(300);
    await pause(2500);
    terminated = true;
    child.kill();
  } else {
    const limit = setTimeout(() => {
      terminated = true;
      child.kill();
    }, 60000);
    await exited.finally(() => clearTimeout(limit));
  }
  const code = await exited;
  if (interactive && existsSync(log)) output = readFileSync(log, "utf8");
  const text = stripTerminal(output);
  writeFileSync(resolve(dir, "output.txt"), text);
  const after = existsSync(audit) ? readFileSync(audit) : null;
  const events = (after?.toString("utf8") ?? "").split("\n").flatMap((line) => {
    try {
      const row = JSON.parse(line);
      return row && typeof row === "object" ? [row] : [];
    } catch {
      return [];
    }
  });
  return {
    case: kase,
    harness: /** @type {'claude'|'codex'} */ (harness),
    interactive,
    exitCode:
      interactive || terminated || typeof code !== "number" ? null : code,
    promptRequests: current.carried,
    events,
    auditExists: after !== null,
    auditUnchanged: prepared === null || !!after?.equals(prepared),
    // The saved observation keeps hook and Vouch lines; full output stays in reports/.
    output: [
      ...new Set(
        text
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => /VOUCH[-_]|[Hh]ook/.test(line)),
      ),
    ].join("\n"),
  };
}

const cliVersion = execFileSync(cli, ["--version"], {
  encoding: "utf8",
  env: { PATH: process.env.PATH ?? "", HOME: base },
  timeout: 10000,
}).trim();
/** @type {PropagationObservation[]} */
const observations = [];
/** @type {string[]} */
const errors = [];
try {
  for (const kase of propagationCases(harness)) {
    const observation = await exercise(kase);
    observations.push(observation);
    errors.push(
      ...verifyPropagation(observation).map((error) => `${kase}:${error}`),
    );
  }
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
} finally {
  server.closeAllConnections();
  await new Promise((accept) => server.close(accept));
}
const result = {
  v: 1,
  kind: "native-cli-observation",
  scripted: true,
  humanApproval: false,
  modelEvaluation: false,
  runs: [
    {
      harness,
      cliVersion,
      platform: process.platform,
      interactive,
      nodeVersion: process.version,
      observations,
    },
  ],
  errors,
  ok: errors.length === 0,
};
const summary = resolve(base, "summary.json");
writeFileSync(summary, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${result.ok ? "PASS" : "FAIL"} ${harness} ${mode}: ${summary}`);
process.exitCode = result.ok ? 0 : 1;
