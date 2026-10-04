import { test } from "node:test";
import { nativeRegistrationNames } from "../../../core/hooks/lib/areas.mjs";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { guardWrites } from "../../../core/hooks/lib/guard.mjs";
import { fakeClock, sandbox } from "../../helpers/runtime.mjs";

for (const harness of /** @type {const} */ (["claude", "codex", "cursor"]))
  test(`${harness}: external shell globs protect only the selected runtime and native registrations`, async (t) => {
    const box = await sandbox(t, { git: false });
    await box.write("project/kept", "project");
    const names = nativeRegistrationNames[`.${harness}`] ?? [];
    for (const name of names)
      await box.write(`home/.${harness}/${name}`, "native bytes");
    const files = await createFileStore(box.path("project"));
    const ctx = {
      projectRoot: box.path("project"),
      harness,
      generation: "test",
      ...fakeClock(),
      readText: files.readText,
      locate: files.locate,
    };
    const home = box.path("home").replaceAll("\\", "/");
    const native = `${home}/.${harness}`;
    const entry = `${home}/.vouch/versions/hash/${harness}/hooks/vouch-guard-writes.mjs`;
    /** @param {string} command */
    const decide = (command) =>
      guardWrites(
        {
          session_id: "test",
          cwd: ctx.projectRoot,
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command },
        },
        ctx,
        entry,
      );
    for (const pattern of [
      `"${native}/"*.json`,
      `"${native}/"${names[0]?.replace(/^./, "?")}`,
      `"${native}/"${names[0]?.replace(/^(.)/, "[$1]")}`,
      `"${home}/".*/hooks.json`,
      `"${native}/"**`,
      `"${home}/.vouch/versions/"*/${harness}/hooks/*.mjs`,
    ]) {
      // Claude protects settings rather than hooks; choose its known registration for this glob.
      const command = `rm ${pattern.replace(".*/hooks.json", ".*/*.json")}`;
      const result = await decide(command);
      t.assert.equal(result.decision, "deny", command);
      if (result.decision === "deny")
        t.assert.match(result.reason, /^VOUCH-GUARD-INSTALLATION:/);
    }
    const redirected = await decide(`echo changed > "${native}/"*.json`);
    t.assert.equal(redirected.decision, "deny");
    for (const command of [
      `cat "${native}/"*.json`,
      `rm "${native}/"cache*.txt`,
      `rm "${home}/unrelated/.${harness}/"*.json`,
      `rm "${home}/.vouch/versions/other/"*/hooks/*.mjs`,
    ])
      t.assert.equal((await decide(command)).decision, "allow", command);
    for (const name of names)
      t.assert.equal(
        await box.read(`home/.${harness}/${name}`),
        "native bytes",
      );
  });
