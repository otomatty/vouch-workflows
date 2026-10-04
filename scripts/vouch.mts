import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnose, initialize, install, remove } from "./lib/install.mjs";

try {
  const [command, ...args] = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (
      !key ||
      ![
        "--harness",
        "--scope",
        "--project",
        "--home",
        "--dist",
        "--intent",
      ].includes(key) ||
      !value ||
      value.startsWith("--") ||
      flags[key] !== undefined
    )
      throw new Error(
        "INSTALL-ARGS: use install|update|remove|init|doctor --harness claude|codex|cursor --scope user|project [--project path] [--home path] [--intent id]",
      );
    flags[key] = value;
  }
  if (
    !command ||
    !["install", "update", "remove", "init", "doctor"].includes(command) ||
    !["claude", "codex", "cursor"].includes(flags["--harness"] ?? "") ||
    !["user", "project"].includes(flags["--scope"] ?? "project") ||
    (["install", "update", "remove"].includes(command) &&
      flags["--scope"] === undefined)
  )
    throw new Error(
      "INSTALL-ARGS: known command, harness and explicit install scope required",
    );
  if (
    flags["--intent"] !== undefined &&
    !/^[a-z0-9][a-zA-Z0-9_-]{0,127}$/.test(flags["--intent"])
  )
    throw new Error("INSTALL-ARGS: invalid Intent");
  const dist = resolve(
    flags["--dist"] ?? fileURLToPath(new URL("../dist/", import.meta.url)),
  );
  if (
    flags["--dist"] === undefined &&
    ["install", "update"].includes(command)
  ) {
    const built = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./package.mjs", import.meta.url))],
      { encoding: "utf8", windowsHide: true },
    );
    if (built.status !== 0) throw new Error(`INSTALL-PACKAGE: ${built.stderr}`);
  }
  const options = {
    harness: flags["--harness"] as string,
    scope: flags["--scope"] ?? "project",
    project: resolve(flags["--project"] ?? process.cwd()),
    home: resolve(flags["--home"] ?? homedir()),
    dist,
    ...(flags["--intent"] === undefined ? {} : { intent: flags["--intent"] }),
  };
  const result =
    command === "install" || command === "update"
      ? install(options, command)
      : command === "init"
        ? initialize(options)
        : command === "remove"
          ? remove(options)
          : diagnose(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ v: 1, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 2;
}
