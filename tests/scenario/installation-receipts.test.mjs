import { rm } from "node:fs/promises";
import { test as group } from "node:test";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

for (const layout of ["project", "home", "binding"])
  group(
    `${layout}: restoration validates ownership before touching files`,
    async (t) => {
      const box = await sandbox(t);
      const root = layout === "home" ? "home" : "project";
      const statePath = `${root}/.vouch/${layout === "binding" ? "bindings" : "installations"}/cursor.json`;
      const marker = "# keep repository configuration\n";
      let original = "";
      let baseline = /** @type {Record<string,string>} */ ({});
      await test(
        "prepare the legitimate installation and unrelated Git settings",
        async (t) => {
          distribution(t, box, "cursor");
          const installed = installRun(
            "install",
            box,
            "cursor",
            layout === "project" ? "project" : "user",
          );
          t.assert.equal(installed.status, 0, installed.stdout);
          if (layout === "binding")
            t.assert.equal(installRun("init", box, "cursor", "user").status, 0);
          await box.write(
            `${root}/.git/config`,
            `[core]\nrepositoryformatversion = 0\n${marker}`,
          );
          original = await box.read(statePath);
          baseline = tree(box.root);
        },
        t,
      );
      const actions =
        layout === "binding"
          ? [
              { command: "install", scope: "project" },
              { command: "remove", scope: "project" },
              { command: "init", scope: "user" },
              { command: "remove", scope: "user" },
            ]
          : ["install", "update", "remove"].map((command) => ({
              command,
              scope: layout === "home" ? "user" : "project",
            }));
      for (const variant of ["git-path", "changed-hooks", "file-backup"])
        for (const action of actions) {
          if (variant === "file-backup" && action.command !== "remove")
            continue;
          await test(
            `${action.command}/${action.scope} refuses the forged ${variant} receipt`,
            async (t) => {
              const state = JSON.parse(original);
              if (variant === "git-path")
                state.owned.push({
                  path: ".git/config",
                  kind: "block",
                  content: marker,
                  previous: null,
                });
              else if (variant === "changed-hooks") {
                const entry = state.owned.find(
                  (/** @type {{kind:string}} */ item) => item.kind === "hooks",
                );
                const text = await box.read(`${root}/${entry.path}`);
                const content = entry.content;
                entry.content = content.replaceAll(
                  "vouch-launch.mjs",
                  "other-launch.mjs",
                );
                await box.write(
                  `${root}/${entry.path}`,
                  text.replace(content, entry.content),
                );
              } else
                state.owned.find(
                  (/** @type {{kind:string}} */ item) => item.kind === "file",
                ).previous = "invented backup bytes";
              await box.write(statePath, JSON.stringify(state));
              try {
                const before = tree(box.root);
                const result = installRun(
                  action.command,
                  box,
                  "cursor",
                  action.scope,
                );
                t.assert.equal(result.status, 2, result.stdout + result.stderr);
                t.assert.deepEqual(tree(box.root), before);
              } finally {
                const after = tree(box.root);
                for (const path of Object.keys(after))
                  if (baseline[path] === undefined) await rm(box.path(path));
                for (const [path, bytes] of Object.entries(baseline))
                  if (after[path] !== bytes)
                    await box.write(
                      path,
                      Buffer.from(bytes, "base64").toString("utf8"),
                    );
              }
            },
            t,
          );
        }
    },
  );
