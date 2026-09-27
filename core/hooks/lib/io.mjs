import { createIntentAuditStore } from "./audit.mjs";
import { readContext } from "./env.mjs";
import { createFileStore } from "./fs.mjs";
import { isHookResult, parseInput } from "./validation.mjs";

/**
 * Process boundary. Fail open on malformed input, implementation or persistence errors.
 * stdout stays empty until a separate harness-specific output adapter is defined.
 * @param {import('./contracts.mjs').HookMain} main
 * @param {import('./runtime-contracts.mjs').RuntimeOptions} [options]
 * @returns {Promise<void>}
 */
export async function run(main, options = {}) {
  const stderr = options.stderr ?? process.stderr;
  const finish =
    options.finish ??
    ((code) => {
      process.exitCode = code;
    });
  /** @type {0|2} */ let code = 0;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of options.stdin ?? process.stdin) {
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
    await files.resolvePath(input.cwd);
    if ("tool_input" in input && Object.hasOwn(input.tool_input, "file_path")) {
      const path = input.tool_input.file_path;
      if (typeof path !== "string")
        throw new Error("HOOK-14: invalid file_path");
      await files.resolvePath(path);
    }
    const audit =
      options.audit ??
      context.audit ??
      (context.intent
        ? createIntentAuditStore(files, context.intent)
        : undefined);
    const result = await main(input, {
      ...context,
      ...(audit ? { audit } : {}),
    });
    if (!isHookResult(result))
      throw new Error("HOOK-3: invalid handler result");
    if (result.events?.length) {
      if (!audit)
        throw new Error("AUDIT-MISSING: explicit audit destination required");
      await audit.append(result.events);
    }
    if (result.decision === "deny") {
      stderr.write(`${result.reason}\n`);
      code = 2;
    }
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
