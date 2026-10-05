// Exercise copied approval inputs and the build gate with an installed CLI. Development-only.
// Usage: node scripts/check-approval.mjs <claude|codex> <absolute CLI path>
// Expectations: docs/development/approval-boundary.md. The loopback provider scripts every request.
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
import { snapshotIntent } from "../core/hooks/lib/approval.mjs";
import {
  approvalReason,
  approvalSteps,
  verifyApproval,
} from "./lib/approval-native.mjs";
import { projectHookTrust } from "./lib/codex-hook-trust.mjs";
import { promptCarried } from "./lib/propagation.mjs";

export type ApprovalObservation =
  import("./native-contracts.mjs").ApprovalObservation;

const [harness, executable, ...extra] = process.argv.slice(2);
if (
  (harness !== "claude" && harness !== "codex") ||
  !executable ||
  !isAbsolute(executable) ||
  !existsSync(executable) ||
  extra.length
)
  throw new Error(
    "APPROVAL-ARGS: use node scripts/check-approval.mjs <claude|codex> <absolute CLI path>",
  );
if (process.platform === "win32")
  throw new Error("APPROVAL-PLATFORM: POSIX only; Windows is unverified");
const cli = executable as string;
const repository = fileURLToPath(new URL("../", import.meta.url));
execFileSync(process.execPath, ["scripts/package.mjs", "--check"], {
  cwd: repository,
  timeout: 10000,
});
const reports = resolve(repository, "reports");
mkdirSync(reports, { recursive: true });
const base = mkdtempSync(resolve(reports, `approval-${harness}-`));
const project = resolve(base, "project space");
const home = resolve(base, "home");
mkdirSync(home, { recursive: true });
cpSync(resolve(repository, `dist/${harness}`), project, { recursive: true });
execFileSync("git", ["init", "--quiet", project], { timeout: 5000 });
const intent = "260929-approval";
const artifact = resolve(project, `vouch/intents/${intent}/intent.md`);
const audit = resolve(project, `vouch/intents/${intent}/audit/events.jsonl`);
const code = resolve(project, "src/app.js");
const draft = [
  "---\nstatus: draft\n---\n# Scripted approval exercise\n",
  "<!-- sec:acceptance -->\n## Acceptance\n\nAC-1: the app module exists.\n",
  "<!-- sec:scope -->\n## Scope\n\nOne new module only.\n",
  "<!-- sec:plan -->\n## Plan\n\n| Unit | ACs | Scope | Risk | Design |\n| --- | --- | --- | --- | --- |\n| U1 | AC-1 | src/app.js | L: new file | not-required: no contract |\n",
].join("\n");
mkdirSync(resolve(artifact, ".."), { recursive: true });
writeFileSync(artifact, draft);
const write = "Exercise the scripted implementation write.";
const patch =
  "*** Begin Patch\n*** Add File: src/app.js\n+export const app = 1;\n*** End Patch\n";

/** Requests of the running step. */
let current = {
  prompt: "",
  carried: 0,
  result: null as string | null,
};
let requests = 0;
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((block) =>
            block && typeof block === "object" && "text" in block
              ? String(block.text)
              : "",
          )
          .join("\n")
      : "";

const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const url = request.url ?? "";
  if (
    current.prompt !== write &&
    promptCarried(harness, url, body, current.prompt)
  )
    current.carried++;
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
  const emit = (type: string, data: object) =>
    response.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
    );
  const done = "Scripted approval exercise completed.";
  if (harness === "claude") {
    const messages = Array.isArray(value.messages) ? value.messages : [];
    const main =
      current.prompt === write && textOf(messages[0]?.content).includes(write);
    const turns = messages.filter(
      (m: { role: string }) => m.role === "assistant",
    ).length;
    if (main && turns > 0)
      current.result = messages
        .flatMap((m: { content: unknown }) =>
          Array.isArray(m.content) ? m.content : [],
        )
        .filter(
          (b: { type: string; tool_use_id?: string }) =>
            b.type === "tool_result" && b.tool_use_id === "toolu_approval_0",
        )
        .map((b: { content: unknown }) => textOf(b.content))
        .join("\n");
    const tool = main && turns === 0;
    const block = tool
      ? {
          type: "tool_use",
          id: "toolu_approval_0",
          name: "Write",
          input: { file_path: code, content: "export const app = 1;\n" },
        }
      : { type: "text", text: done };
    emit("message_start", {
      message: {
        id: `msg_approval_${turns}`,
        type: "message",
        role: "assistant",
        model: value.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    emit("content_block_start", {
      index: 0,
      content_block: tool
        ? { ...block, input: {} }
        : { type: "text", text: "" },
    });
    emit("content_block_delta", {
      index: 0,
      delta: tool
        ? {
            type: "input_json_delta",
            partial_json: JSON.stringify(block.input),
          }
        : { type: "text_delta", text: done },
    });
    emit("content_block_stop", { index: 0 });
    emit("message_delta", {
      delta: {
        stop_reason: tool ? "tool_use" : "end_turn",
        stop_sequence: null,
      },
      usage: { output_tokens: 1 },
    });
    emit("message_stop", {});
  } else {
    const input = Array.isArray(value.input) ? value.input : [];
    let turn: { thread_source?: string } = {};
    try {
      turn = JSON.parse(
        value.client_metadata?.["x-codex-turn-metadata"] ?? "{}",
      );
    } catch {}
    const main =
      current.prompt === write &&
      turn.thread_source === "user" &&
      JSON.stringify(input).includes(write);
    const outputs = input.filter(
      (item: { type: string }) => item.type === "custom_tool_call_output",
    );
    if (main && outputs.length) current.result = textOf(outputs.at(-1)?.output);
    const output =
      main && !outputs.length
        ? {
            type: "custom_tool_call",
            id: "ctc_approval_0",
            call_id: "call_approval_0",
            name: "exec",
            input: `try { const r = await tools.apply_patch(${JSON.stringify(patch)}); text("OK " + JSON.stringify(r)); } catch (e) { text("ERR " + String(e)); }`,
          }
        : {
            type: "message",
            id: `msg_approval_${requests}`,
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: done, annotations: [] }],
          };
    const completed = {
      id: `resp_approval_${requests}`,
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
  throw new Error("APPROVAL-PROVIDER: no loopback port");
const provider = `http://127.0.0.1:${address.port}`;
const key = "local-fixture-only";
// OS lookup only; the caller names the other harness so the registration must set its own.
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "",
  LANG: "C.UTF-8",
  TERM: "xterm-256color",
  HOME: home,
  VOUCH_HARNESS: harness === "claude" ? "codex" : "claude",
  VOUCH_INTENT: intent,
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
} else {
  Object.assign(env, { CODEX_HOME: home, VOUCH_PROJECT_ROOT: project });
  let config = `check_for_update_on_startup = false\nmodel_provider = "vouch_observer"\n[model_providers.vouch_observer]\nname = "Local observer only"\nbase_url = "${provider}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n[analytics]\nenabled = false\n[features]\nhooks = true\nplugins = false\nremote_plugin = false\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`;
  writeFileSync(resolve(home, "config.toml"), config);
  const hooks = JSON.parse(
    readFileSync(resolve(project, ".codex/hooks.json"), "utf8"),
  ).hooks;
  const trust = await projectHookTrust(
    cli,
    env,
    project,
    ["SessionStart", "UserPromptSubmit", "PreToolUse"].map(
      (event) => hooks[event][0].hooks[0].command,
    ),
  );
  config += trust.config;
  writeFileSync(resolve(home, "config.toml"), config);
}

const rows = () =>
  (existsSync(audit) ? readFileSync(audit, "utf8") : "")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [{ type: null, harness: null, synthetic: null }];
      }
    });

async function exercise(
  step: import("./native-contracts.mjs").ApprovalStep,
): Promise<ApprovalObservation> {
  const gate = rows().find((row) => row.type === "gate.opened");
  const prompt = step.startsWith("write-")
    ? write
    : step === "review"
      ? "vouch review"
      : step === "approve"
        ? `vouch approve ${gate?.id}`
        : `vouch confirm ${step.slice("confirm-".length)}`;
  current = { prompt, carried: 0, result: null };
  const writing = prompt === write;
  const args =
    harness === "claude"
      ? [
          "--print",
          prompt,
          "--model",
          "vouch-capture-model",
          "--strict-mcp-config",
          "--tools",
          writing ? "Write" : "",
          ...(writing
            ? ["--permission-mode", "acceptEdits", "--max-turns", "3"]
            : []),
        ]
      : ["exec", "-s", "workspace-write", "-C", project, prompt];
  const child = spawn(cli, args, {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));
  let terminated = false;
  const limit = setTimeout(() => {
    terminated = true;
    child.kill();
  }, 60000);
  const exit = await new Promise((accept) => child.once("exit", accept));
  clearTimeout(limit);
  writeFileSync(resolve(base, `${step}.txt`), output);
  const text = existsSync(artifact) ? readFileSync(artifact, "utf8") : "";
  return {
    step,
    exitCode: terminated || typeof exit !== "number" ? null : exit,
    promptRequests: current.carried,
    reason: approvalReason(writing ? (current.result ?? "") : output),
    written: existsSync(code),
    status: snapshotIntent(text)?.status ?? null,
  };
}

const observations: ApprovalObservation[] = [];
const errors: string[] = [];
try {
  for (const step of approvalSteps()) observations.push(await exercise(step));
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
} finally {
  server.closeAllConnections();
  await new Promise((accept) => server.close(accept));
}
const cliVersion = execFileSync(cli, ["--version"], {
  encoding: "utf8",
  env: { PATH: process.env.PATH ?? "", HOME: base },
  timeout: 10000,
}).trim();
const run: import("./native-contracts.mjs").ApprovalRun = {
  harness,
  cliVersion,
  platform: process.platform,
  nodeVersion: process.version,
  observations,
  audit: rows().map((row) => ({
    type: row.type,
    harness: row.harness,
    synthetic: row.synthetic ?? false,
  })),
  revisionKept:
    snapshotIntent(existsSync(artifact) ? readFileSync(artifact, "utf8") : "")
      ?.revision.sha256 === snapshotIntent(draft)?.revision.sha256,
  errors,
};
run.errors = [...errors, ...verifyApproval(run)];
const result = {
  v: 1,
  kind: "native-cli-observation",
  scripted: true,
  humanApproval: false,
  modelEvaluation: false,
  runs: [run],
};
writeFileSync(
  resolve(base, "summary.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  `${run.errors.length ? "FAIL" : "PASS"} ${harness}: ${resolve(base, "summary.json")}`,
);
process.exitCode = run.errors.length ? 1 : 0;
