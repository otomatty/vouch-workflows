import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { test as group } from "node:test";
import { windowsShell } from "../../scripts/lib/powershell.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

group(
  "global Claude statusline never executes checkout-selected JavaScript",
  async (t) => {
    const box = await sandbox(t);
    let command = "";
    const marker = box.path("executed-untrusted-code");
    const malicious = `process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed"); process.stdout.write("malicious output\\n");\n`;
    const display = (bash = false) => {
      /** @type {NodeJS.ProcessEnv} */
      const env = { ...process.env, CLAUDE_PROJECT_DIR: box.path("project") };
      delete env.VOUCH_PROJECT_ROOT;
      return spawnSync(
        process.platform === "win32"
          ? bash
            ? join(
                process.env.ProgramFiles ?? "C:\\Program Files",
                "Git/bin/bash.exe",
              )
            : windowsShell()
          : "sh",
        process.platform === "win32" && !bash
          ? ["-NoProfile", "-Command", command]
          : ["-c", command],
        {
          cwd: box.path("project"),
          env,
          encoding: "utf8",
          timeout: 4000,
        },
      );
    };
    await test(
      "install trusted global registration and activate the project",
      async (t) => {
        distribution(t, box, "claude");
        t.assert.equal(installRun("install", box, "claude", "user").status, 0);
        t.assert.equal(
          installRun("init", box, "claude", "user", ["--intent", "safe-intent"])
            .status,
          0,
        );
        command = JSON.parse(await box.read("home/.claude/settings.json"))
          .statusLine.command;
        const before = tree(box.root);
        const result = display();
        t.assert.equal(result.status, 0, result.stderr);
        t.assert.match(result.stdout, /safe-intent/);
        t.assert.deepEqual(tree(box.root), before);
      },
      t,
    );
    await test(
      "the actual global registration also renders through Git Bash on Windows",
      async (t) => {
        const before = tree(box.root);
        const result = display(true);
        t.assert.equal(result.status, 0, result.stderr);
        t.assert.match(result.stdout, /safe-intent/);
        t.assert.deepEqual(tree(box.root), before);
      },
      t,
    );
    await test(
      "reject a canonical-looking runtime without its installation record",
      async (t) => {
        const original = await box.read("project/vouch/config.json");
        const config = JSON.parse(original);
        const digest = "f".repeat(64);
        const root = `.vouch/versions/${digest}/claude`;
        config.harnesses.claude = {
          scope: "project",
          digest,
          runtimeRoot: root,
          registrationScope: "project",
        };
        await box.write(
          `project/${root}/hooks/vouch-statusline.mjs`,
          malicious,
        );
        await box.write("project/vouch/config.json", JSON.stringify(config));
        try {
          const before = tree(box.root);
          const result = display();
          t.assert.equal(result.status, 0, result.stderr);
          t.assert.equal(existsSync(marker), false);
          t.assert.equal(result.stdout, "");
          t.assert.match(result.stderr, /VOUCH-LAUNCH/);
          t.assert.deepEqual(tree(box.root), before);
        } finally {
          await box.write("project/vouch/config.json", original);
          await rm(marker, { force: true });
        }
      },
      t,
    );
    await test(
      "self-consistent project records and archives still cannot replace trusted display code",
      async (t) => {
        await box.write(
          "dist/claude/.claude/hooks/vouch-statusline.mjs",
          malicious,
        );
        const installed = installRun("install", box, "claude", "project");
        t.assert.equal(
          installed.status,
          0,
          installed.stdout + installed.stderr,
        );
        const before = tree(box.root);
        const result = display();
        t.assert.equal(result.status, 0, result.stderr);
        t.assert.equal(existsSync(marker), false);
        t.assert.match(result.stdout, /safe-intent/);
        t.assert.deepEqual(tree(box.root), before);
      },
      t,
    );
    await test(
      "reject nonempty selected-runtime corruption before rendering",
      async (t) => {
        const config = JSON.parse(await box.read("project/vouch/config.json"));
        const root = config.harnesses.claude.runtimeRoot;
        await box.write(
          join("project", root, "hooks/vouch-guard-writes.mjs"),
          "// changed but nonempty\n",
        );
        await rm(marker, { force: true });
        const before = tree(box.root);
        const result = display();
        t.assert.equal(result.status, 0, result.stderr);
        t.assert.equal(existsSync(marker), false);
        t.assert.equal(result.stdout, "");
        t.assert.match(result.stderr, /INSTALL-VERSION/);
        t.assert.deepEqual(tree(box.root), before);
      },
      t,
    );
  },
);
