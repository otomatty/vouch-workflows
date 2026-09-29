import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import commands from "../core/registry/intent-review.json" with {
  type: "json",
};
import { projectHookTrust } from "./lib/codex-hook-trust.mjs";
import { nativeEnvironment, probeNode } from "./lib/native-environment.mjs";
import { verifyNativeReview } from "./lib/native-review-evidence.mjs";

const [executable, ...extra] = process.argv.slice(2);
if (
  !executable ||
  !isAbsolute(executable) ||
  !existsSync(executable) ||
  extra.length ||
  !process.stdin.isTTY
)
  throw new Error(
    "NATIVE-ARGS: use node scripts/check-codex-review.mjs <absolute Codex CLI path> in a terminal",
  );
const repository = fileURLToPath(new URL("../", import.meta.url));
execFileSync(process.execPath, ["scripts/package.mjs", "--check"], {
  cwd: repository,
  windowsHide: true,
  timeout: 10000,
});
const reports = resolve(repository, "reports");
mkdirSync(reports, { recursive: true });
const base = mkdtempSync(resolve(reports, "codex-review-"));
const project = resolve(base, "project");
const home = resolve(base, "home");
mkdirSync(home);
cpSync(resolve(repository, "dist/codex"), project, { recursive: true });
/** @param {string} root @returns {Map<string,Buffer>} */
function snapshot(root) {
  return new Map(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => [
        resolve(entry.parentPath, entry.name),
        readFileSync(resolve(entry.parentPath, entry.name)),
      ]),
  );
}
const installed = snapshot(project);
const intent = "260928-native-review";
const env = nativeEnvironment(process.env, { home, project, intent });
const nodeVersion = probeNode(env);
execFileSync("git", ["init", "--quiet", project], {
  env,
  windowsHide: true,
  timeout: 5000,
});
const cliVersion = execFileSync(executable, ["--version"], {
  env,
  encoding: "utf8",
  windowsHide: true,
  timeout: 5000,
}).trim();
const intentDir = resolve(project, "vouch/intents", intent);
mkdirSync(intentDir, { recursive: true });
const draft =
  "---\nstatus: draft\n---\n# Scripted Codex native input exercise\n";
writeFileSync(resolve(intentDir, "intent.md"), draft);
const audit = resolve(intentDir, "audit/events.jsonl");
/** @returns {unknown[]} */
function rows() {
  return existsSync(audit)
    ? readFileSync(audit, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}
/** @param {unknown} row @param {string} type @returns {row is {type:string,id:string}} */
function eventOfType(row, type) {
  return (
    !!row &&
    typeof row === "object" &&
    "type" in row &&
    row.type === type &&
    "id" in row &&
    typeof row.id === "string"
  );
}
let providerRequests = 0;
const server = createServer((request, response) => {
  providerRequests++;
  request.resume();
  response
    .writeHead(400, { "Content-Type": "application/json" })
    .end(
      '{"error":"NATIVE-PROVIDER: a blocked prompt reached the local observer"}',
    );
});
/** @type {import('./native-contracts.mjs').NativeSubmission[]} */
const submissions = [];
/** @type {string[]} */
const errors = [];
let trustedHooks = 0;
/** @param {string} prompt @param {'gate.opened'|'intent.approved'} event */
async function submit(prompt, event) {
  const child = spawn(
    /** @type {string} */ (executable),
    [
      "--no-alt-screen",
      "-a",
      "never",
      "-s",
      "workspace-write",
      "-C",
      project,
      prompt,
    ],
    { cwd: project, env, windowsHide: true, stdio: "inherit" },
  );
  let observed = false;
  let terminatedByController = false;
  /** @type {NodeJS.Timeout|undefined} */ let stop;
  const terminate = () => {
    terminatedByController = true;
    child.kill();
  };
  const watch = setInterval(() => {
    try {
      if (!observed && rows().some((row) => eventOfType(row, event))) {
        observed = true;
        stop = setTimeout(terminate, 2500);
      }
    } catch {
      errors.push("NATIVE-AUDIT: unreadable observation");
      terminate();
    }
  }, 200);
  const limit = setTimeout(terminate, 40000);
  try {
    const exitCode = await new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("exit", accept);
    });
    submissions.push({
      event,
      observed,
      exitCode: typeof exitCode === "number" ? exitCode : null,
      terminatedByController,
    });
  } finally {
    clearInterval(watch);
    clearTimeout(limit);
    clearTimeout(stop);
  }
}
try {
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => accept(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("NATIVE-PROVIDER: no loopback port");
  let config = `check_for_update_on_startup = false\nmodel_provider = "vouch_observer"\n[model_providers.vouch_observer]\nname = "Local observer only"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n[analytics]\nenabled = false\n[features]\nhooks = true\nplugins = false\nremote_plugin = false\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`;
  writeFileSync(resolve(home, "config.toml"), config);
  const registration = JSON.parse(
    readFileSync(resolve(project, ".codex/hooks.json"), "utf8"),
  );
  const commandKey =
    process.platform === "win32" ? "commandWindows" : "command";
  const expected = ["SessionStart", "UserPromptSubmit", "PreToolUse"].map(
    (event) => registration.hooks[event][0].hooks[0][commandKey],
  );
  const trust = await projectHookTrust(executable, env, project, expected);
  writeFileSync(
    resolve(base, "hooks-list.json"),
    JSON.stringify(trust.hooks, null, 2),
  );
  trustedHooks = trust.hooks.length;
  config += trust.config;
  writeFileSync(resolve(home, "config.toml"), config);
  await submit(commands.open, "gate.opened");
  const gate = rows().find((row) => eventOfType(row, "gate.opened"));
  if (gate && eventOfType(gate, "gate.opened"))
    await submit(`${commands.approvePrefix}${gate.id}`, "intent.approved");
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
} finally {
  server.closeAllConnections();
  await new Promise((accept) => server.close(accept));
}
/** @type {unknown[]} */
let events = [];
try {
  events = rows();
} catch {
  errors.push("NATIVE-AUDIT: invalid JSONL");
}
const distributionUnchanged = [...installed].every(
  ([path, bytes]) => existsSync(path) && readFileSync(path).equals(bytes),
);
const actualDraft = existsSync(resolve(intentDir, "intent.md"))
  ? readFileSync(resolve(intentDir, "intent.md"), "utf8")
  : "";
errors.push(
  ...verifyNativeReview({
    events,
    providerRequests,
    expectedDraft: draft,
    actualDraft,
    distributionUnchanged,
  }),
);
if (submissions.length !== 2 || submissions.some((item) => !item.observed))
  errors.push("NATIVE-SUBMISSIONS");
const result = {
  v: 1,
  kind: "native-cli-observation",
  scripted: true,
  humanApproval: false,
  modelEvaluation: false,
  cliVersion,
  nodeVersion,
  sandbox: "workspace-write",
  trustedHooks,
  providerRequests,
  submissions,
  events,
  draftUnchanged: actualDraft === draft,
  distributionUnchanged,
  errors,
  ok: errors.length === 0,
};
const summary = resolve(base, "summary.json");
writeFileSync(summary, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `\n${result.ok ? "PASS" : "FAIL"} scripted native review: ${summary}`,
);
process.exitCode = result.ok ? 0 : 1;
