import { test } from "node:test";
import { nativeRegistrationNames } from "../../../core/hooks/lib/areas.mjs";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { guardWrites } from "../../../core/hooks/lib/guard.mjs";
import { fakeClock, sandbox } from "../../helpers/runtime.mjs";

for (const harness of /** @type {const} */ (["claude", "codex", "cursor"]))
  test(`${harness}: unresolved expansion segments protect synthesized installation names`, async (t) => {
    const box = await sandbox(t, { git: false });
    await box.write("project/kept", "project bytes");
    const files = await createFileStore(box.path("project"));
    const ctx = {
      projectRoot: box.path("project"),
      harness,
      generation: "test",
      ...fakeClock(),
      readText: files.readText,
      locate: files.locate,
    };
    const entry = box.path(
      `home/.vouch/versions/hash/${harness}/hooks/vouch-guard-writes.mjs`,
    );
    const name = nativeRegistrationNames[`.${harness}`]?.[0] ?? "";
    const paths = [
      `$HOME/.${harness.slice(0, 2)}\${X}${harness.slice(2)}/${name}`,
      `$HOME/.${harness}/${name.slice(0, 2)}\${X}${name.slice(2)}`,
      `$HOME/.vo\${X}uch/versions/hash/${harness}/hooks/kept.mjs`,
      `$HOME/.${harness.slice(0, 2)}\${X:-\${Y}}${harness.slice(2)}/${name}`,
      `$HOME/.${harness.slice(0, 2)}%X%${harness.slice(2)}/${name}`,
      "$TARGET",
    ];
    for (const cwd of [ctx.projectRoot, box.path("home")])
      for (const path of paths) {
        const input = {
          session_id: "test",
          cwd,
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: `X=; rm "${path}"` },
        };
        t.assert.equal(
          (await guardWrites(input, ctx, entry)).decision,
          "deny",
          path,
        );
        input.tool_input.command = `cat "${path}"`;
        t.assert.equal(
          (await guardWrites(input, ctx, entry)).decision,
          "allow",
          path,
        );
      }
    t.assert.equal(await box.read("project/kept"), "project bytes");
  });
