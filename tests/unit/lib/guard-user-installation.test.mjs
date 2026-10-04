import { mkdir, symlink } from "node:fs/promises";
import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { guardWrites } from "../../../core/hooks/lib/guard.mjs";
import { fakeClock, sandbox } from "../../helpers/runtime.mjs";

const profiles = /** @type {const} */ ([
  { harness: "claude", names: ["settings.json", "settings.local.json"] },
  { harness: "codex", names: ["hooks.json", "config.toml"] },
  { harness: "cursor", names: ["hooks.json"] },
]);

for (const { harness, names } of profiles) {
  for (const layout of ["outside", "nested"])
    test(`${harness} ${layout} user guard protects native registrations and their aliases without writing`, async (t) => {
      const box = await sandbox(t, { git: false });
      const project = box.path("project");
      const home = layout === "nested" ? "project/nested-home" : "home";
      const native = `${home}/.${harness}`;
      await box.write(
        "project/vouch/intents/example/audit/events.jsonl",
        "audit\n",
      );
      await box.write(`${native}/${names[0]}`, "original\n");
      await box.write(`${native}/notes.md`, "notes\n");
      await mkdir(box.path("project/aliases"));
      await symlink(
        box.path(native),
        box.path("project/aliases/native"),
        "junction",
      );
      const files = await createFileStore(project);
      const ctx = {
        projectRoot: project,
        harness,
        generation: "test",
        ...fakeClock(),
        readText: files.readText,
        locate: files.locate,
      };
      /** @param {string} tool_name @param {Record<string, unknown>} tool_input */
      const decide = (tool_name, tool_input) =>
        guardWrites(
          {
            session_id: "s",
            cwd: project,
            hook_event_name: "PreToolUse",
            tool_name,
            tool_input,
          },
          ctx,
          box.path(
            `${home}/.vouch/versions/hash/${harness}/hooks/vouch-guard-writes.mjs`,
          ),
        );
      for (const name of names) {
        for (const file of [
          box.path(`${native}/${name}`),
          `aliases/native/${name}`,
        ]) {
          const attempts = /** @type {[string, Record<string, unknown>][]} */ ([
            ["Bash", { command: `echo changed > '${file}'` }],
            ["Bash", { command: `rm '${file}'` }],
          ]);
          if (harness !== "codex")
            attempts.push(
              ["Write", { file_path: file, content: "changed" }],
              [
                "Edit",
                {
                  file_path: file,
                  old_string: "original",
                  new_string: "changed",
                },
              ],
            );
          if (harness !== "claude")
            attempts.push([
              "apply_patch",
              {
                command: `*** Begin Patch\n*** Update File: ${file}\n+changed\n*** End Patch`,
              },
            ]);
          if (harness === "cursor")
            attempts.push(["Delete", { file_path: file }]);
          for (const [tool, input] of attempts) {
            const result = await decide(tool, input);
            t.assert.equal(result.decision, "deny", `${tool} ${file}`);
            if (result.decision === "deny")
              t.assert.match(result.reason, /^VOUCH-GUARD-INSTALLATION:/);
          }
          t.assert.equal(
            (await decide("Bash", { command: `cat '${file}'` })).decision,
            "allow",
          );
        }
      }
      for (const file of [box.path(native), "aliases/native"]) {
        t.assert.equal(
          (await decide("Bash", { command: `rm -rf '${file}'` })).decision,
          "deny",
        );
        if (harness === "cursor")
          t.assert.equal(
            (await decide("Delete", { file_path: file })).decision,
            "deny",
          );
        if (harness !== "codex")
          t.assert.equal(
            (await decide("Write", { file_path: file, content: "ordinary" }))
              .decision,
            "allow",
          );
      }
      for (const file of [
        box.path(`unrelated/.${harness}/${names[0]}`),
        box.path(`${native}/notes.md`),
      ]) {
        t.assert.equal(
          (await decide("Bash", { command: `echo changed > '${file}'` }))
            .decision,
          "allow",
        );
      }
      t.assert.equal(await box.read(`${native}/${names[0]}`), "original\n");
      t.assert.equal(await box.read(`${native}/notes.md`), "notes\n");
      t.assert.equal(
        await box.read("project/vouch/intents/example/audit/events.jsonl"),
        "audit\n",
      );
      if (names.length > 1)
        t.assert.equal(
          (await files.locate(box.path(`${native}/${names[1]}`))).kind,
          "missing",
        );
    });
}

test("user guard follows a native registration directory junction into the project", async (t) => {
  const box = await sandbox(t, { git: false });
  await box.write("project/shared/hooks.json", "original\n");
  await mkdir(box.path("home"));
  await symlink(
    box.path("project/shared"),
    box.path("home/.cursor"),
    "junction",
  );
  const files = await createFileStore(box.path("project"));
  const ctx = {
    projectRoot: box.path("project"),
    harness: /** @type {const} */ ("cursor"),
    generation: "test",
    ...fakeClock(),
    readText: files.readText,
    locate: files.locate,
  };
  for (const file_path of [
    box.path("home/.cursor/hooks.json"),
    "shared/hooks.json",
  ]) {
    const result = await guardWrites(
      {
        session_id: "s",
        cwd: ctx.projectRoot,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path, content: "changed" },
      },
      ctx,
      box.path("home/.vouch/versions/hash/cursor/hooks/vouch-guard-writes.mjs"),
    );
    t.assert.equal(result.decision, "deny", file_path);
  }
  t.assert.equal(await box.read("project/shared/hooks.json"), "original\n");
});
