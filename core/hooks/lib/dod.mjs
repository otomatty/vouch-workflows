import approval from "../../registry/approval.json" with { type: "json" };
import build from "../../registry/build.json" with { type: "json" };
import documents from "../../registry/project-documents.json" with {
  type: "json",
};
import guard from "../../registry/write-guard.json" with { type: "json" };
import { findApproval, snapshotIntent } from "./approval.mjs";
import { createIntentAuditStore, listEvents } from "./audit.mjs";
import { tableRows } from "./checkpoints.mjs";
import { elapsedMilliseconds, newId, now, sha256Hex } from "./clock.mjs";
import { readIntent, readSecrets } from "./env.mjs";
import { changeStatus, readGit, spawn } from "./git.mjs";

// DoD execution and recording; see docs/development/git-guard.md.
/** @typedef {import('./runtime-contracts.mjs').DoctorCheck} Check */

/** @param {string} id @param {boolean} ok @param {string} detail @returns {Check} */
const check = (id, ok, detail) => ({ id, ok, detail });
/** @param {...Check} checks */
const report = (...checks) => ({
  v: /** @type {const} */ (1),
  ok: checks.every((item) => item.ok),
  checks,
});
/** @param {string} text */
const lineCount = (text) => (text.match(/\n/g) ?? []).length;

/**
 * A fenced block longer than any backtick run of the output, keeping its last lines.
 * @param {string} output
 */
function fenced(output) {
  const lines = output.replace(/\n$/, "").split("\n");
  const kept = lines.slice(-build.dod.outputLines);
  const omitted = lines.length - kept.length;
  const runs = [...output.matchAll(/`+/g)].map((match) => match[0].length);
  const fence = "`".repeat(Math.max(3, ...runs.map((length) => length + 1)));
  const note = omitted ? `(${omitted} earlier lines omitted)\n` : "";
  return `${fence}text\n${note}${kept.join("\n")}\n${fence}\n`;
}

/** @type {import('./runtime-contracts.mjs').RunDod} */
export async function runDod(
  files,
  environment,
  _git,
  ports = { intent: readIntent(), now, secrets: readSecrets(build.dod.redact) },
) {
  const { intent } = ports;
  if (!intent)
    return report(check("DOD-SCOPE", false, "VOUCH_INTENT names no Intent"));
  const home = `${guard.intents.join("/")}/${intent}`;
  const audit = createIntentAuditStore(files, intent);
  const text = await files.readText(`${home}/${documents.artifacts.intent}`);
  if (
    text === null ||
    snapshotIntent(text)?.status !== "approved" ||
    !findApproval({ text, events: await listEvents(audit), intent, newId })
  )
    return report(
      check("DOD-PLAN", false, `${home}: no approved plan with evidence`),
    );
  const rules = await files.readText(approval.rules);
  const rows = tableRows(rules ?? "", build.dod.section) ?? [];
  if (rows.length === 0)
    return report(check("DOD-RULES", false, `${approval.rules}: no DoD rows`));
  const git = readGit(environment.projectRoot, ports.execute);
  const commit = (await git("rev-parse", "--verify", "-q", "HEAD"))?.trim();
  const status = await git(...changeStatus);
  const clean = Boolean(
    commit &&
      status?.split("\0").every((entry) => !entry || /^.. vouch\//.test(entry)),
  );
  const linked = commit
    ? `\`${commit}\`${clean ? "" : " (uncommitted changes outside vouch/; not linked)"}`
    : "none";
  const started = ports.now();
  /** @type {{line:number,name:string,item?:import('./contracts.mjs').DodCommand}[]} */
  const rowsAt = [];
  let body = "";
  let missing = 0;
  for (const { cells } of rows) {
    const [target = "", cell = ""] = cells.map((value) =>
      value.replaceAll("\\|", "|"),
    );
    const [command, cwd = "."] = [...cell.matchAll(/`([^`]+)`/g)].map(
      (match) => `${match[1]}`,
    );
    const name = target || `row ${rowsAt.length + 1}`;
    const line = lineCount(body) + 2;
    body += `\n### ${name}\n\n`;
    if (!command) {
      missing++;
      rowsAt.push({ line, name });
      body += "- Result: unconfigured; not executed\n";
      continue;
    }
    const begun = ports.now();
    /** @type {import('./runtime-contracts.mjs').Spawned} */ let result;
    try {
      const at = await files.resolvePath(cwd);
      result = await spawn(
        command,
        [],
        { cwd: at, shell: true, stdio: ["ignore", "pipe", "pipe"] },
        ports.execute,
      );
    } catch (error) {
      result = { status: null, error: /** @type {Error} */ (error) };
    }
    const duration = elapsedMilliseconds(begun, ports.now()) ?? 0;
    const exit = result.status;
    /** @type {import('./contracts.mjs').DodCommand} */ const item = {
      target: name,
      command,
      cwd,
      result: exit === 0 ? "pass" : "fail",
      duration_ms: duration,
      ...(exit === null ? {} : { exit_code: exit }),
    };
    let output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `${result.error.message}\n` : ""}`;
    for (const secret of ports.secrets ?? [])
      output = output.replaceAll(secret, build.dod.redact.mask);
    body += `- Command: \`${command}\`\n- Directory: \`${cwd}\`\n- Result: ${item.result} (exit ${exit ?? "none"}, ${duration} ms)\n\n${fenced(output)}`;
    rowsAt.push({ line, name, item });
  }
  const commands = rowsAt.flatMap(({ item }) => (item ? [item] : []));
  const passed = commands.every((item) => item.result === "pass");
  const result = missing === 0 && passed ? "pass" : "fail";
  const header = `<!-- dod -->\n## DoD ${started}\n\n- Intent: \`${intent}\`\n- Commit: ${linked}\n- Result: ${result}\n`;
  const entry = header + body;
  const sha256 = sha256Hex(Buffer.from(entry, "utf8"));
  const log = `${home}/${documents.artifacts.build}`;
  let offset = lineCount(header);
  await files.updateText(log, (before) => {
    const kept = before ? `${before.replace(/\n?$/, "\n")}\n` : "";
    offset += lineCount(kept);
    return kept + entry;
  });
  /** @type {Check[]} */ const checks = [
    check("DOD-COMMIT", clean, `commit ${linked}`),
    ...rowsAt.map(({ line, name, item }) =>
      check(
        "DOD-COMMAND",
        item?.result === "pass",
        `${name}: ${item ? `\`${item.command}\` ${item.result}` : "unconfigured"}; ${log}#L${offset + line}`,
      ),
    ),
  ];
  const key = JSON.stringify(["hook.check", "dod", intent, sha256]);
  const id = newId(commit ?? "", key);
  await audit.append([
    {
      id,
      v: 1,
      type: "hook.check",
      ts: started,
      actor: "hook",
      intent,
      stage: "build",
      check: "dod",
      result,
      duration_ms: elapsedMilliseconds(started, ports.now()) ?? 0,
      missing,
      ...(commit ? { commit } : {}),
      clean,
      commands,
      output: { path: "build-log.md", sha256 },
    },
  ]);
  return report(...checks, check("DOD-RECORD", true, `hook.check ${id}`));
}
