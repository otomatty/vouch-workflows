import { mkdir, symlink } from "node:fs/promises";
import { test } from "node:test";
import { createFileStore } from "../../../core/hooks/lib/fs.mjs";
import { guardWrites } from "../../../core/hooks/lib/guard.mjs";
import { fakeClock, sandbox } from "../../helpers/runtime.mjs";

const intent = "260929-guard";

const draft = "---\nstatus: draft\n---\n# Guarded draft\n\nAC-1: keep it.\n";

const approvedText = draft.replace("draft", "approved");

const record = `${JSON.stringify({ id: "evt_x", v: 1, type: "session.started", ts: "2026-09-29T00:00:00.000Z", actor: "hook", session: "s" })}\n`;

const audit = `vouch/intents/${intent}/audit/events.jsonl`;

test("Cursor Delete protects resolved external project ancestors in direct and managed layouts", async (t) => {
  for (const layout of ["direct", "project", "user"]) {
    const box = await sandbox(t, { git: false });
    const project = box.path("workspace/project");
    const relativeRuntime =
      layout === "user"
        ? "home/.vouch/versions/hash/cursor"
        : `workspace/project/${layout === "direct" ? ".cursor" : ".vouch/versions/hash/cursor"}`;
    await box.write(
      `${relativeRuntime}/registry/installation.json`,
      '{"harness":"cursor","registration":"hooks.json"}',
    );
    await box.write(
      `${relativeRuntime}/hooks/vouch-guard-writes.mjs`,
      "// entry\n",
    );
    await box.write(`workspace/project/${audit}`, record);
    await box.write(
      "workspace/project/vouch/intents/260929-done/intent.md",
      approvedText,
    );
    await box.write("workspace/unrelated/cache.txt", "application\n");
    const files = await createFileStore(project);
    const ctx = {
      projectRoot: project,
      harness: /** @type {const} */ ("cursor"),
      generation: "test",
      ...fakeClock(),
      readText: files.readText,
      locate: files.locate,
    };
    for (const tool_name of ["Delete", "Write", "Edit"]) {
      for (const file_path of [
        ".",
        project,
        "..",
        box.path("workspace"),
        box.root,
        box.path("workspace/unrelated"),
      ]) {
        const result = await guardWrites(
          {
            session_id: "s",
            cwd: project,
            hook_event_name: "PreToolUse",
            tool_name,
            tool_input: {
              file_path,
              content: "ordinary",
              old_string: "old",
              new_string: "new",
            },
          },
          ctx,
          box.path(`${relativeRuntime}/hooks/vouch-guard-writes.mjs`),
        );
        const protectedDelete =
          tool_name === "Delete" &&
          file_path !== box.path("workspace/unrelated");
        t.assert.equal(
          result.decision,
          protectedDelete ? "deny" : "allow",
          `${layout} ${tool_name} ${file_path}`,
        );
        if (result.decision === "deny")
          t.assert.match(result.reason, /VOUCH-GUARD-(AUDIT|INSTALLATION)/);
      }
    }
    t.assert.equal(await box.read(`workspace/project/${audit}`), record);
  }
});

test("managed guards allow unrelated resolved external .vouch files across file and shell tools", async (t) => {
  const box = await sandbox(t, { git: false });
  const root = box.path("project");
  const outside = box.path("unrelated/.vouch/cache.txt");
  await box.write("unrelated/.vouch/cache.txt", "application cache");
  await mkdir(root);
  const files = await createFileStore(root);
  const ctx = {
    projectRoot: root,
    harness: /** @type {const} */ ("cursor"),
    generation: "test",
    ...fakeClock(),
    readText: files.readText,
    locate: files.locate,
  };
  for (const prefix of ["home", "project"]) {
    const runtime = box.path(`${prefix}/.vouch/versions/hash/cursor`);
    for (const [
      tool_name,
      tool_input,
    ] of /** @type {[string,Record<string,unknown>][]} */ ([
      ["Write", { file_path: outside, content: "new cache" }],
      ["Edit", { file_path: outside, old_string: "cache", new_string: "data" }],
      ["Delete", { file_path: outside }],
      ["Write", { file_path: `${outside}.new`, content: "new cache" }],
      ["Bash", { command: `echo data > '${outside}'` }],
      ["Bash", { command: `rm '${outside}'` }],
      [
        "apply_patch",
        {
          command: `*** Begin Patch\n*** Update File: ${outside}\n+data\n*** End Patch`,
        },
      ],
    ])) {
      const result = await guardWrites(
        {
          session_id: "s",
          cwd: root,
          hook_event_name: "PreToolUse",
          tool_name,
          tool_input,
        },
        ctx,
        `${runtime}/hooks/vouch-guard-writes.mjs`,
      );
      t.assert.equal(result.decision, "allow", `${prefix}: ${tool_name}`);
    }
  }
  t.assert.equal(
    await box.read("unrelated/.vouch/cache.txt"),
    "application cache",
  );
});

test("managed user runtime is protected outside the project and manual operations remain callable", async (t) => {
  const box = await sandbox(t, { git: false });
  await mkdir(box.path("project"));
  const files = await createFileStore(box.path("project"));
  const runtime = box.path("home/.vouch/versions/hash/cursor/hooks");
  const ctx = {
    projectRoot: box.path("project"),
    harness: /** @type {const} */ ("cursor"),
    generation: "test",
    ...fakeClock(),
    readText: files.readText,
    locate: files.locate,
  };
  /** @param {string} tool @param {Record<string,unknown>} tool_input */
  const decide = (tool, tool_input) =>
    guardWrites(
      {
        session_id: "s",
        cwd: ctx.projectRoot,
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input,
      },
      ctx,
      `${runtime}/vouch-guard-writes.mjs`,
    );
  t.assert.equal(
    (
      await decide("Write", {
        file_path: `${runtime}/lib/env.mjs`,
        content: "tamper",
      })
    ).decision,
    "deny",
  );
  t.assert.equal(
    (
      await decide("Write", {
        file_path: box.path("outside/unrelated.mjs"),
        content: "code",
      })
    ).decision,
    "allow",
  );
  for (const action of [
    "doctor",
    "dod",
    "lifecycle",
    "question",
    "migrate",
    "report",
  ])
    t.assert.equal(
      (
        await decide("Bash", {
          command: `node '${runtime}/vouch-launch.mjs' ${action} manual`,
        })
      ).decision,
      "allow",
      action,
    );
  t.assert.equal(
    (
      await decide("Bash", {
        command: `node '${runtime}/vouch-launch.mjs' session user`,
      })
    ).decision,
    "deny",
  );
});

test("managed runtime aliases protect existing and missing targets across file, patch and shell tools", async (t) => {
  const box = await sandbox(t, { git: false });
  const root = box.path("project");
  const runtime = box.path("home/.vouch/versions/hash/cursor");
  await box.write(
    "home/.vouch/versions/hash/cursor/hooks/lib/env.mjs",
    "trusted",
  );
  await box.write(
    "home/.vouch/versions/hash/cursor/registry/installation.json",
    "{}",
  );
  await box.write("home/other/file.mjs", "unrelated");
  await mkdir(box.path("project/links"), { recursive: true });
  await symlink(runtime, box.path("project/links/selected"), "junction");
  await symlink(box.path("home"), box.path("project/links/home"), "junction");
  await symlink(
    box.path("home/other"),
    box.path("project/links/unrelated"),
    "junction",
  );
  const files = await createFileStore(root);
  const ctx = {
    projectRoot: root,
    harness: /** @type {const} */ ("cursor"),
    generation: "test",
    ...fakeClock(),
    readText: files.readText,
    locate: files.locate,
  };
  /** @param {string} tool_name @param {Record<string,unknown>} tool_input */
  const decide = (tool_name, tool_input) =>
    guardWrites(
      {
        session_id: "s",
        cwd: root,
        hook_event_name: "PreToolUse",
        tool_name,
        tool_input,
      },
      ctx,
      `${runtime}/hooks/vouch-guard-writes.mjs`,
    );
  for (const [
    tool,
    input,
  ] of /** @type {[string,Record<string,unknown>][]} */ ([
    [
      "Write",
      { file_path: "links/selected/hooks/lib/env.mjs", content: "tamper" },
    ],
    [
      "Edit",
      {
        file_path: "links/selected/registry/installation.json",
        old_string: "{}",
        new_string: "tamper",
      },
    ],
    ["Write", { file_path: "links/selected/hooks/new.mjs", content: "tamper" }],
    ["Delete", { file_path: "links/selected/hooks/lib/env.mjs" }],
    ["Delete", { file_path: "links/home" }],
    [
      "apply_patch",
      {
        command:
          "*** Begin Patch\n*** Update File: links/selected/hooks/lib/env.mjs\n+tamper\n*** End Patch",
      },
    ],
    ["Bash", { command: "echo tamper > links/selected/hooks/lib/env.mjs" }],
    ["Bash", { command: "rm -rf links/home" }],
  ])) {
    const result = await decide(tool, input);
    t.assert.equal(result.decision, "deny", tool);
    t.assert.match(
      result.decision === "deny" ? result.reason : "",
      /VOUCH-GUARD-INSTALLATION/,
    );
  }
  for (const [
    tool,
    input,
  ] of /** @type {[string,Record<string,unknown>][]} */ ([
    [
      "Write",
      { file_path: "links/unrelated/file.mjs", content: "application" },
    ],
    ["Bash", { command: "cat links/selected/hooks/lib/env.mjs" }],
  ]))
    t.assert.equal((await decide(tool, input)).decision, "allow", tool);
  t.assert.equal(
    await box.read("home/.vouch/versions/hash/cursor/hooks/lib/env.mjs"),
    "trusted",
  );
});
