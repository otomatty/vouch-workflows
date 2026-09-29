import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { newId } from "../../core/hooks/lib/clock.mjs";
import { evidenced } from "./approval.mjs";
import { planned } from "./intent-review.mjs";
import { runHook, sandbox } from "./runtime.mjs";
import { toolFixture } from "./write-guard.mjs";

// Git guard and DoD in a real repository; see docs/development/git-guard.md.
const intent = "260929-guarded";
export const branch = `vouch/${intent}`;
export const audit = `vouch/intents/${intent}/audit/events.jsonl`;
export const buildLog = `vouch/intents/${intent}/build-log.md`;
/** Passes before tests exist and after the implementation; fails in between. */
const check = [
  'const { existsSync } = require("node:fs");',
  'const red = existsSync("tests/app.test.js") && !existsSync("src/app.js");',
  'console.log(red ? "1 failing: app is missing" : "all passing");',
  "process.exit(red ? 1 : 0);",
  "",
].join("\n");
const rules = [
  "---",
  "language: en",
  "checkpoints: topic",
  "---",
  "",
  "# Project rules",
  "",
  "<!-- sec:dod -->",
  "## Definition of done",
  "",
  "| Target | Command and working directory | Pass condition | Evidence location |",
  "| --- | --- | --- | --- |",
  "| Unit tests | `node check.js` in `.` | exit 0 | build-log.md |",
  "",
].join("\n");

/** Git with a fixed identity and no signing; throws on failure.
 * @param {string} root @param {...string} args */
export function gitIn(root, ...args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Vouch Test",
      "-c",
      "user.email=test@vouch.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
}

/**
 * A project on an Intent branch from main with an approved two-Unit plan, a DoD in rules.md and
 * the runtime copied to `.claude/` (ignored), so the DoD command resolves this root. The approval
 * records are hand-authored with derived identities (helpers/approval.mjs); vouch/ stays
 * uncommitted so audit records carry across branch switches.
 * @param {import('node:test').TestContext} t @param {'claude'|'codex'} [harness]
 */
export async function gitBox(t, harness = "claude") {
  const box = await sandbox(t);
  const draft = planned([
    ["U1", "L: small", "not-required: none"],
    ["U2", "L: small", "not-required: none"],
  ]);
  const { gate, approval } = evidenced(draft, { intent, harness });
  await box.write(
    `vouch/intents/${intent}/intent.md`,
    draft.replace("status: draft", "status: approved"),
  );
  await box.write(
    audit,
    `${JSON.stringify(gate)}\n${JSON.stringify(approval)}\n`,
  );
  await box.write("vouch/rules.md", rules);
  await box.write(".gitignore", ".claude/\n");
  await box.write("check.js", check);
  await cp(resolve("core/hooks"), box.path(".claude/hooks"), {
    recursive: true,
  });
  await cp(resolve("core/registry"), box.path(".claude/registry"), {
    recursive: true,
  });
  /**
   * Commit every change outside vouch/ with a subject, outside the guard.
   * @param {string} subject
   */
  const commit = (subject) => {
    gitIn(box.root, "add", "-A", "--", ".", ":(exclude)vouch");
    gitIn(box.root, "commit", "-qm", subject);
    return gitIn(box.root, "rev-parse", "HEAD").trim();
  };
  commit("chore: base");
  gitIn(box.root, "checkout", "-qb", branch);
  /** Run the copied DoD command as the model would. @param {Record<string,string>} [env] */
  const dod = (env = {}) => {
    const result = spawnSync(
      process.execPath,
      [box.path(".claude/hooks/vouch-dod.mjs")],
      {
        cwd: box.root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        env: { ...process.env, VOUCH_INTENT: intent, ...env },
      },
    );
    return { status: result.status, report: JSON.parse(result.stdout) };
  };
  /**
   * Append a DoD record shaped and identified as the command writes it. The guard cannot tell
   * it from a run (docs/development/git-guard.md); the flow test runs the real command.
   * @param {string} sha @param {number} exit @param {Record<string,unknown>} [extra]
   */
  const prove = (sha, exit, extra = {}) => {
    const sha256 = createHash("sha256").update(`${sha} ${exit}`).digest("hex");
    const result = exit === 0 ? "pass" : "fail";
    const record = {
      id: newId(sha, JSON.stringify(["hook.check", "dod", intent, sha256])),
      v: 1,
      type: "hook.check",
      ts: "2026-09-29T00:00:00.000Z",
      actor: "hook",
      intent,
      stage: "build",
      check: "dod",
      result,
      duration_ms: 1,
      missing: 0,
      commit: sha,
      clean: true,
      commands: [
        {
          target: "Unit tests",
          command: "node check.js",
          cwd: ".",
          result,
          duration_ms: 1,
          exit_code: exit,
        },
      ],
      output: { path: "build-log.md", sha256 },
      ...extra,
    };
    return appendFile(box.path(audit), `${JSON.stringify(record)}\n`);
  };
  /**
   * The registered guard on a Bash call derived from a versioned capture.
   * @param {string} command @param {{harness?:'claude'|'codex',intent?:string}} [options]
   */
  const guard = (command, options = {}) =>
    runHook(
      "vouch-guard-writes",
      toolFixture(options.harness ?? harness, "Bash", box.root, { command }),
      { root: box.root, intent: options.intent ?? intent },
    );
  return { ...box, commit, dod, prove, guard };
}
