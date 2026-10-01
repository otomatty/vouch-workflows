import operations from "../../registry/operations.json" with { type: "json" };
import workflow from "../../registry/workflow.json" with { type: "json" };
import { approvedText } from "./approval.mjs";
import { createIntentAuditStore } from "./audit.mjs";
import { readContext, readDoctorContext, readIntent } from "./env.mjs";
import { createFileStore, descriptorWriter, readDescriptor } from "./fs.mjs";
import { isHookResult, parseInput } from "./validation.mjs";

/**
 * Process boundary. Fail open on malformed input, implementation or persistence errors.
 * stdout carries only an allowed result's plain-text context, after its events are durable.
 * @param {import('./contracts.mjs').HookMain} main
 * @param {import('./runtime-contracts.mjs').RuntimeOptions} [options]
 * @returns {Promise<void>}
 */
export async function run(main, options = {}) {
  // Hook stdio stays on descriptors 0 and 2; the stdio stream getters would load stream modules.
  const stderr = options.stderr ?? descriptorWriter(2);
  const finish =
    options.finish ??
    ((code) => {
      process.exitCode = code;
    });
  /** @type {0|2} */ let code = 0;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of options.stdin ?? readDescriptor(0)) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size >= 1024 * 1024)
        throw new Error("HOOK-14: input must be smaller than 1 MiB");
      chunks.push(bytes);
    }
    const input = parseInput(Buffer.concat(chunks).toString("utf8"));
    if (!input) throw new Error("HOOK-14: invalid hook input");
    const context = options.context ?? readContext();
    const files = options.files ?? (await createFileStore(context.projectRoot));
    // A failed containment check fails open, so a PreToolUse guard classifies paths itself.
    const contained = input.hook_event_name !== "PreToolUse";
    if (contained) await files.resolvePath(input.cwd);
    if ("tool_input" in input && Object.hasOwn(input.tool_input, "file_path")) {
      const path = input.tool_input.file_path;
      if (typeof path !== "string")
        throw new Error("HOOK-14: invalid file_path");
      if (contained) await files.resolvePath(path);
    }
    const audit =
      options.audit ??
      context.audit ??
      (context.intent
        ? createIntentAuditStore(files, context.intent)
        : undefined);
    const result = await main(input, {
      ...context,
      readText: (path) => files.readText(path),
      locate: (path, from) => files.locate(path, from),
      ...(audit ? { audit } : {}),
    });
    if (!isHookResult(result))
      throw new Error("HOOK-3: invalid handler result");
    if (result.events?.length) {
      if (!audit)
        throw new Error("AUDIT-MISSING: explicit audit destination required");
      await audit.append(result.events);
    }
    // Approval changes the configured draft only after its evidence is durable.
    if (result.decision === "deny" && result.approve) {
      const { sha256 } = result.approve;
      if (!context.intent)
        throw new Error("APPROVAL-SCOPE: configured intent required");
      await files.updateText(
        `vouch/intents/${context.intent}/intent.md`,
        (before) => {
          const after = before === null ? null : approvedText(before, sha256);
          if (after === null)
            throw new Error(
              "APPROVAL-STALE: the draft changed before approval",
            );
          return after === before ? null : after;
        },
      );
    }
    if (result.decision === "deny") {
      stderr.write(`${result.reason}\n`);
      code = 2;
    } else if (result.context)
      (options.stdout ?? descriptorWriter(1)).write(`${result.context}\n`);
  } catch (error) {
    try {
      stderr.write(
        `HOOK-2: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    } catch {
      /* A closed diagnostic stream must not change the fail-open exit. */
    }
  }
  finish(code);
}

/** Manual diagnostics have their own output and failure contract, without stdin.
 * @param {import('./runtime-contracts.mjs').DoctorMain} main
 * @param {string} entryUrl
 * @param {import('./runtime-contracts.mjs').DoctorOptions} [options]
 */
export async function runDoctor(main, entryUrl, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const finish =
    options.finish ??
    ((code) => {
      process.exitCode = code;
    });
  /** @type {import('./runtime-contracts.mjs').DoctorReport} */ let report;
  try {
    const environment = options.environment ?? readDoctorContext(entryUrl);
    const files =
      options.files ?? (await createFileStore(environment.projectRoot));
    const git = options.git ?? (await import("./doctor-process.mjs")).gitStatus;
    report = await main(files, environment, git());
  } catch (error) {
    report = {
      v: 1,
      ok: false,
      checks: [
        {
          id: "DOCTOR-IO",
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  try {
    stdout.write(`${JSON.stringify(report)}\n`);
  } catch {
    finish(2);
    return;
  }
  finish(report.ok ? 0 : 2);
}

/** Harness display wiring: one line on stdout and exit 0, also when the observation fails.
 * Reads only; the project root and harness come from the entry's installed location.
 * @param {import('./runtime-contracts.mjs').StatuslineMain} main
 * @param {string} entryUrl
 * @param {import('./runtime-contracts.mjs').StatuslineOptions} [options]
 */
export async function runStatusline(main, entryUrl, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  /** @type {string} */ let line;
  try {
    const environment = options.environment ?? readDoctorContext(entryUrl);
    const files =
      options.files ?? (await createFileStore(environment.projectRoot));
    const harness = /(?:^|\/)\.codex$/.test(environment.installationRoot)
      ? "codex"
      : "claude";
    line = await main(
      files,
      options.intent === undefined ? readIntent() : options.intent,
      harness,
    );
  } catch (error) {
    const code =
      error instanceof Error
        ? (/^[A-Z][A-Z0-9-]+(?=:)/.exec(error.message)?.[0] ?? "ERROR")
        : "ERROR";
    line = `Vouch: ${operations.labels[/** @type {'ja'|'en'} */ (workflow.defaults.language)].unavailable} (${code})`;
  }
  try {
    stdout.write(`${line}\n`);
  } catch {
    /* A closed display stream has no one to tell. */
  }
  (
    options.finish ??
    ((code) => {
      process.exitCode = code;
    })
  )(0);
}
