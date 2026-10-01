import { execFileSync, spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { packageRun } from "../helpers/packaging.mjs";
import { validator } from "../helpers/registry.mjs";
import { card, decisions, home, intent } from "../helpers/resume.mjs";
import { sandbox } from "../helpers/runtime.mjs";
import { toolFixture } from "../helpers/write-guard.mjs";

// Installed question, report and statusline entries: docs/development/resume.md.
/** @param {string} root @param {string} file @param {string[]} args @param {Record<string,string>} [env] */
const node = (root, file, args = [], env = {}) =>
  spawnSync(process.execPath, [join(root, file), ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 4000,
    env: { ...process.env, VOUCH_INTENT: intent, ...env },
  });

/** @param {import('node:test').TestContext} t @param {'claude'|'codex'} harness */
async function installed(t, harness) {
  const box = await sandbox(t);
  const root = box.path("日本語 project $ apostrophe'");
  t.assert.equal(packageRun(["--out", box.path("dist")]).status, 0);
  await cp(box.path(`dist/${harness}`), root, { recursive: true });
  execFileSync("git", ["init", "-q", "--initial-branch=main", root], {
    windowsHide: true,
  });
  const relative = (/** @type {string} */ path) =>
    `日本語 project $ apostrophe'/${path}`;
  await box.write(relative(`${home}/decisions.md`), decisions(card()));
  const settings = JSON.parse(
    await box.read(
      relative(
        `.${harness}/${harness === "claude" ? "settings" : "hooks"}.json`,
      ),
    ),
  );
  return { box, root, relative, settings };
}

for (const harness of /** @type {const} */ (["claude", "codex"])) {
  test(`installed ${harness} question and report commands record and aggregate through the hook-owned path`, async (t) => {
    t.plan(9);
    const { box, root, relative, settings } = await installed(t, harness);
    const dir = `.${harness}/hooks`;
    const guard = spawnSync(
      process.execPath,
      [join(root, dir, "vouch-guard-writes.mjs")],
      {
        cwd: root,
        input: JSON.stringify(
          toolFixture(harness, "Bash", root, {
            command: `node ${dir}/vouch-question.mjs ask Q-1`,
          }).payload,
        ),
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
        env: {
          ...process.env,
          VOUCH_PROJECT_ROOT: root,
          VOUCH_HARNESS: harness,
          VOUCH_INTENT: intent,
        },
      },
    );
    t.assert.equal(guard.status, 0, guard.stderr);
    const ask = node(root, `${dir}/vouch-question.mjs`, ["ask", "Q-1"]);
    const fallback = node(root, `${dir}/vouch-question.mjs`, [
      "default",
      "Q-1",
    ]);
    const report = node(root, `${dir}/vouch-report.mjs`);
    const json = JSON.parse(report.stdout);
    t.assert.deepEqual(
      [ask.status, fallback.status, report.status],
      [0, 0, 0],
      `${ask.stdout}${fallback.stdout}`,
    );
    t.assert.equal(validator("doctor-report")(json), true);
    t.assert.deepEqual(
      [
        json.report.types["question.asked"].count,
        json.report.types["question.defaulted"].measures.wait_ms.n,
      ],
      [1, 1],
    );
    const records = (await box.read(relative(`${home}/audit/events.jsonl`)))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    t.assert.deepEqual(
      records.map((r) => [r.type, r.actor, r.choice]),
      [
        ["question.asked", "model", undefined],
        ["question.defaulted", "model", "A"],
      ],
    );
    const [stop] = settings.hooks.Stop[0].hooks;
    t.assert.match(
      harness === "claude" ? stop.args[0] : stop.command,
      /\/hooks\/vouch-record-aside-answer\.mjs/,
    );
    t.assert.deepEqual(
      settings.hooks.SessionStart[0].matcher.split("|"),
      harness === "claude"
        ? ["startup", "resume", "clear", "compact"]
        : ["startup", "resume"],
    );
    t.assert.equal(
      "statusLine" in settings,
      harness === "claude",
      "Codex has no command statusline",
    );
  });
}

test("the installed Claude statusLine command prints the explicit Intent's line from the project root", async (t) => {
  t.plan(5);
  const { root, settings } = await installed(t, "claude");
  t.assert.deepEqual(settings.statusLine, {
    type: "command",
    command: `node "\${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/vouch-statusline.mjs"`,
  });
  const direct = node(root, ".claude/hooks/vouch-statusline.mjs");
  t.assert.deepEqual(
    [direct.status, direct.stdout],
    [0, `Vouch ${intent} | 確認 ? | 未回答 0\n`],
  );
  if (process.platform === "win32") {
    // Windows runs the same entry directly; the POSIX expansion below is the shell's.
    t.assert.equal(direct.stderr, "");
    t.assert.equal(direct.stdout.split("\n").length, 2);
    return;
  }
  const shell = (/** @type {Record<string,string>} */ env) =>
    spawnSync("/bin/sh", ["-c", settings.statusLine.command], {
      cwd: root,
      encoding: "utf8",
      timeout: 4000,
      env: { ...process.env, VOUCH_INTENT: intent, ...env },
    });
  const fromEnv = shell({ CLAUDE_PROJECT_DIR: root });
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const fromCwd = spawnSync("/bin/sh", ["-c", settings.statusLine.command], {
    cwd: root,
    encoding: "utf8",
    timeout: 4000,
    env: { ...env, VOUCH_INTENT: intent },
  });
  t.assert.deepEqual(
    [fromEnv.stdout, fromCwd.stdout],
    [direct.stdout, direct.stdout],
  );
  t.assert.equal(
    shell({ CLAUDE_PROJECT_DIR: root, VOUCH_INTENT: "" }).stdout,
    "Vouch: Intent 未指定（VOUCH_INTENT）\n",
  );
});
