import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { registration } from "../../scripts/lib/install-registration.mjs";
import { windowsShell } from "../../scripts/lib/powershell.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

const shells =
  process.platform === "win32"
    ? [
        { executable: windowsShell(), args: ["-NoProfile", "-Command"] },
        {
          executable: join(
            process.env.ProgramFiles ?? "C:\\Program Files",
            "Git/bin/bash.exe",
          ),
          args: ["-c"],
        },
      ]
    : [{ executable: "/bin/sh", args: ["-c"] }];

for (const scope of ["user", "project"])
  for (const shell of shells)
    test(`Windows Claude ${scope} statusline preserves literal paths and arguments through ${shell.executable}`, async (t) => {
      const box = await sandbox(t, { git: false });
      const runtime = "home 日本語 $ dollar ` tick ' apostrophe/runtime";
      await box.write(
        `${runtime}/hooks/vouch-launch.mjs`,
        "console.log(JSON.stringify(process.argv.slice(2)));\n",
      );
      await box.write("project/kept", "project bytes");
      const platform = Object.getOwnPropertyDescriptor(process, "platform");
      let command = "";
      try {
        Object.defineProperty(process, "platform", { value: "win32" });
        command = registration(
          "claude",
          box.path(runtime),
          scope,
          scope === "project" ? box.path("project") : undefined,
        ).statusLine.command;
      } finally {
        if (platform) Object.defineProperty(process, "platform", platform);
      }
      const before = tree(box.root);
      const result = spawnSync(shell.executable, [...shell.args, command], {
        cwd: box.path("project"),
        env: { ...process.env, CLAUDE_PROJECT_DIR: box.path("project") },
        encoding: "utf8",
        windowsHide: true,
        timeout: 4000,
      });
      t.assert.equal(result.status, 0, result.stderr);
      t.assert.deepEqual(JSON.parse(result.stdout), [
        "statusline",
        scope,
        ...(scope === "project" ? [box.path("project")] : []),
      ]);
      t.assert.deepEqual(tree(box.root), before);
    });
