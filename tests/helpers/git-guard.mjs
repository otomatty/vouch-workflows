import { execFileSync, spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { approvalBox, audit, intent, planned } from "./intent-review.mjs";
import { runHook } from "./runtime.mjs";
import { toolFixture } from "./write-guard.mjs";

// Git guard and DoD in a real repository; see docs/development/git-guard.md.
export const branch = `vouch/${intent}`;
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
 * the runtime copied to `.claude/` (ignored), so the DoD command resolves this root.
 * @param {import('node:test').TestContext} t @param {'claude'|'codex'} [harness]
 */
export async function gitBox(t, harness = "claude") {
  const box = await approvalBox(
    t,
    harness,
    planned([
      ["U1", "L: small", "not-required: none"],
      ["U2", "L: small", "not-required: none"],
    ]),
  );
  await box.write(".gitignore", ".claude/\n");
  await box.write("check.js", check);
  await box.write("vouch/rules.md", rules);
  await cp(resolve("core/hooks"), box.path(".claude/hooks"), {
    recursive: true,
  });
  await cp(resolve("core/registry"), box.path(".claude/registry"), {
    recursive: true,
  });
  gitIn(box.root, "add", "-A");
  gitIn(box.root, "commit", "-qm", "chore: base");
  gitIn(box.root, "checkout", "-qb", branch);
  await box.approveAfter();
  /**
   * Commit every change outside vouch/ with a subject, outside the guard. The audit and
   * build-log.md stay uncommitted so their records carry across branch switches.
   * @param {string} subject
   */
  const commit = (subject) => {
    gitIn(box.root, "add", "-A", "--", ".", ":(exclude)vouch");
    gitIn(box.root, "commit", "-qm", subject);
    return gitIn(box.root, "rev-parse", "HEAD").trim();
  };
  /** Run the copied DoD command as the model would. */
  const dod = () => {
    const result = spawnSync(
      process.execPath,
      [box.path(".claude/hooks/vouch-dod.mjs")],
      {
        cwd: box.root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        env: { ...process.env, VOUCH_INTENT: intent },
      },
    );
    return { status: result.status, report: JSON.parse(result.stdout) };
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
  return { ...box, audit, commit, dod, guard };
}
