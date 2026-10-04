import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { registration as generatedRegistration } from "../../../core/hooks/lib/installation-ownership.mjs";
import {
  distributionDigest,
  runtimeContents,
} from "../../../core/hooks/lib/installation-runtime.mjs";
import { runLauncher } from "../../../core/hooks/lib/io.mjs";
import { launch } from "../../../core/hooks/lib/launch.mjs";
import runtime from "../../../core/registry/runtime.json" with { type: "json" };
import { managedOwned } from "../../helpers/managed-ownership.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

const hash = "a".repeat(64);
/** @param {import('node:test').TestContext} t @param {'claude'|'codex'|'cursor'} [harness] */
async function setup(t, harness = "cursor") {
  const box = await sandbox(t);
  const root = box.path("project");
  const runtime = box.path(`project/.vouch/versions/${hash}/${harness}`);
  await mkdir(runtime, { recursive: true });
  await box.write(
    `project/.vouch/versions/${hash}/${harness}/registry/installation.json`,
    JSON.stringify({ harness }),
  );
  const binding = {
    scope: "project",
    digest: hash,
    runtimeRoot: `.vouch/versions/${hash}/${harness}`,
    registrationScope: "project",
  };
  const config = { v: 1, harnesses: { [harness]: binding }, intent: "scope" };
  await box.write("project/vouch/config.json", JSON.stringify(config));
  return {
    box,
    root,
    runtime,
    binding,
    config,
    entry: pathToFileURL(`${runtime}/hooks/vouch-launch.mjs`).href,
  };
}
/** @param {string} root @param {string[]} args @param {{status:number|null,stdout:string,stderr:string}} [result] */
function ports(root, args, result = { status: 0, stdout: "", stderr: "" }) {
  const seen = {
    stdout: "",
    stderr: "",
    code: 0,
    calls: /** @type {unknown[][]} */ ([]),
  };
  const hooks = {
    environment:
      /** @type {ReturnType<typeof import('../../../core/hooks/lib/env.mjs').readLaunchEnvironment>} */ ({
        projectRoot: root,
        cwd: root,
        explicit: false,
        args,
      }),
    stdout: {
      write: (/** @type {string} */ text) => {
        seen.stdout += text;
      },
    },
    stderr: {
      write: (/** @type {string} */ text) => {
        seen.stderr += text;
      },
    },
    finish: (/** @type {number} */ code) => {
      seen.code = code;
    },
    execute: (
      /** @type {string} */ entry,
      /** @type {string[]} */ words,
      /** @type {string} */ input,
      /** @type {unknown} */ selected,
    ) => {
      seen.calls.push([entry, words, input, selected]);
      return result;
    },
    input: (async function* () {
      yield Buffer.from(
        JSON.stringify({
          hook_event_name:
            args[0] === "session" ? "sessionStart" : "preToolUse",
          conversation_id: "conversation",
          tool_name: "Write",
          tool_input: { path: "src/a" },
        }),
      );
    })(),
  };
  return { hooks, seen };
}
test("all managed launchers execute the same runtime through a project junction", async (t) => {
  for (const harness of ["claude", "codex", "cursor"]) {
    const box = await setup(
      t,
      /** @type {'claude'|'codex'|'cursor'} */ (harness),
    );
    const alias = box.box.path("alias");
    await symlink(box.root, alias, "junction");
    for (const args of [
      ["session", "project", alias],
      ["doctor", "manual"],
    ]) {
      const command = ports(alias, args);
      await launch(box.entry, command.hooks);
      t.assert.equal(command.seen.stderr, "");
      t.assert.equal(command.seen.calls.length, 1, `${harness}/${args[0]}`);
      t.assert.equal(
        command.seen.calls[0]?.[0],
        join(
          box.runtime,
          "hooks",
          args[0] === "session"
            ? "vouch-record-session-start.mjs"
            : "vouch-doctor.mjs",
        ),
      );
    }
  }
});
test("launcher selects only the configured project and Intent and routes manual arguments unchanged", async (t) => {
  const box = await setup(t);
  const native = ports(box.root, ["session", "project", box.root], {
    status: 0,
    stdout: "context",
    stderr: "",
  });
  native.hooks.environment = {
    ...native.hooks.environment,
    intent: "unselected",
  };
  await launch(box.entry, native.hooks);
  t.assert.deepEqual(JSON.parse(native.seen.stdout), {
    additional_context: "context",
  });
  const selected = native.seen.calls[0]?.[3];
  t.assert.deepEqual(selected, {
    projectRoot: box.root,
    runtimeRoot: box.runtime,
    harness: "cursor",
    intent: "scope",
  });
  const manual = ports(box.root, ["lifecycle", "manual", "session", "end"], {
    status: 2,
    stdout: "report",
    stderr: "reason",
  });
  await launch(box.entry, manual.hooks);
  t.assert.deepEqual(manual.seen.calls[0]?.[1], ["session", "end"]);
  t.assert.equal(manual.seen.code, 2);
  t.assert.equal(manual.seen.stderr, "reason");
  const failure = ports(box.root, ["doctor", "manual"], {
    status: null,
    stdout: "",
    stderr: "",
  });
  await launch(box.entry, failure.hooks);
  t.assert.equal(failure.seen.code, 2);
});
test("managed commands cannot inherit an Intent into an unconfigured project", async (t) => {
  const box = await setup(t);
  const { intent: _intent, ...config } = box.config;
  await box.box.write("project/vouch/config.json", JSON.stringify(config));
  for (const args of [
    ["session", "project", box.root],
    ["report", "manual"],
  ]) {
    const command = ports(box.root, args);
    command.hooks.environment = {
      ...command.hooks.environment,
      intent: "unselected",
    };
    await launch(box.entry, command.hooks);
    t.assert.equal(command.seen.calls.length, 1);
    t.assert.equal(
      /** @type {{intent:string}|undefined} */ (command.seen.calls[0]?.[3])
        ?.intent,
      "",
    );
  }
});
test("an explicit dot project argument selects command cwd independently of inherited roots", async (t) => {
  const box = await setup(t);
  const command = ports(box.root, ["session", "project", "."]);
  command.hooks.environment = {
    ...command.hooks.environment,
    projectRoot: box.box.root,
    explicit: true,
  };
  await launch(box.entry, command.hooks);
  t.assert.equal(command.seen.stderr, "");
  t.assert.equal(command.seen.calls.length, 1);
  t.assert.equal(
    /** @type {{projectRoot:string}|undefined} */ (command.seen.calls[0]?.[3])
      ?.projectRoot,
    box.root,
  );
});
test("native statusline skips inactive or unverified projects and uses registered code to render a validated selection", async (t) => {
  const box = await setup(t, "claude");
  const source = Object.fromEntries([
    ...runtime.files.map((path) => [`.claude/${path}`, "source"]),
    ...runtime.assets.claude.map((path) => [path, "source"]),
  ]);
  source["AGENTS.md"] = "source";
  source[".claude/registry/runtime.json"] = JSON.stringify(runtime);
  let activationOwned = managedOwned("claude");
  for (const entry of activationOwned) {
    await box.box.write(`project/${entry.path}`, entry.content);
    if (entry.kind === "file") source[entry.path] = entry.content;
  }
  box.binding.digest = distributionDigest(source);
  box.binding.runtimeRoot = `.vouch/versions/${box.binding.digest}/claude`;
  activationOwned = managedOwned("claude", box.binding.runtimeRoot);
  for (const entry of activationOwned)
    await box.box.write(`project/${entry.path}`, entry.content);
  for (const [path, text] of Object.entries(
    runtimeContents(source, "claude", box.binding.runtimeRoot),
  ))
    await box.box.write(`project/${box.binding.runtimeRoot}/${path}`, text);
  for (const [path, text] of Object.entries(source))
    await box.box.write(
      `project/${box.binding.runtimeRoot}/distribution/${path}`,
      text,
    );
  const registration = generatedRegistration(
    "claude",
    box.box.path(`project/${box.binding.runtimeRoot}`),
    "project",
    box.root,
  );
  await box.box.write(
    "project/.claude/settings.json",
    JSON.stringify(registration),
  );
  await box.box.write(
    "project/.vouch/installations/claude.json",
    JSON.stringify({
      v: 1,
      harness: "claude",
      ...box.binding,
      owned: [
        ...activationOwned,
        {
          path: ".claude/settings.json",
          kind: "hooks",
          content: JSON.stringify(registration),
          previous: null,
        },
      ],
    }),
  );
  await box.box.write("project/vouch/config.json", JSON.stringify(box.config));
  for (const root of [box.box.root, box.root]) {
    const display = ports(root, ["statusline", "user"], {
      status: 0,
      stdout: "selected status\n",
      stderr: "",
    });
    await launch(box.entry, display.hooks);
    t.assert.equal(display.seen.code, 0);
    t.assert.equal(display.seen.stderr, "");
    t.assert.equal(
      display.seen.stdout,
      root === box.root ? "selected status\n" : "",
    );
    if (root === box.root)
      t.assert.equal(
        display.seen.calls[0]?.[0],
        join(box.runtime, "hooks/vouch-statusline.mjs"),
      );
  }
  box.binding.digest = "b".repeat(64);
  box.binding.runtimeRoot = `.vouch/versions/${box.binding.digest}/claude`;
  await box.box.write("project/vouch/config.json", JSON.stringify(box.config));
  const pinned = ports(box.root, ["statusline", "user"]);
  await launch(box.entry, pinned.hooks);
  t.assert.equal(pinned.seen.calls.length, 0);
  t.assert.match(pinned.seen.stderr, /VOUCH-LAUNCH/);
  const absent = ports(box.root, ["statusline", "user"]);
  await box.box.write(
    "project/vouch/config.json",
    JSON.stringify({ v: 1, harnesses: {} }),
  );
  await launch(box.entry, absent.hooks);
  t.assert.equal(absent.seen.calls.length, 0);
  t.assert.equal(absent.seen.stderr, "");
});
test("launcher ascends cwd, skips inactive projects, stale registrations and duplicate user hooks", async (t) => {
  const box = await setup(t);
  await mkdir(box.box.path("project/src"));
  const nested = ports(box.box.path("project/src"), ["doctor", "manual"]);
  await launch(box.entry, nested.hooks);
  t.assert.equal(nested.seen.calls.length, 1);
  for (const args of [
    ["session", "user"],
    ["session", "project", box.box.root],
  ]) {
    const skipped = ports(box.root, args);
    await launch(box.entry, skipped.hooks);
    t.assert.equal(skipped.seen.calls.length, 0);
    t.assert.equal(skipped.seen.stdout, "{}\n");
  }
  const inactive = ports(box.box.root, ["doctor", "manual"]);
  await launch(box.entry, inactive.hooks);
  t.assert.equal(inactive.seen.code, 2);
  await box.box.write(
    "project/vouch/config.json",
    JSON.stringify({ v: 1, harnesses: {} }),
  );
  const otherHarness = ports(box.root, ["session", "user"]);
  await launch(box.entry, otherHarness.hooks);
  t.assert.equal(otherHarness.seen.stderr, "");
  t.assert.equal(otherHarness.seen.stdout, "{}\n");
  box.binding.runtimeRoot = `.vouch/versions/${"b".repeat(64)}/cursor`;
  box.binding.digest = "b".repeat(64);
  await box.box.write("project/vouch/config.json", JSON.stringify(box.config));
  const stale = ports(box.root, ["session", "project", box.root]);
  await launch(box.entry, stale.hooks);
  t.assert.equal(stale.seen.calls.length, 0);
  const wrong = ports(box.root, ["doctor", "manual"]);
  await launch(box.entry, wrong.hooks);
  t.assert.match(wrong.seen.stderr, /INSTALL-VERSION/);
});
test("invalid activation and malformed native transport fail open while manual commands report errors", async (t) => {
  const box = await setup(t);
  for (const config of [
    "null",
    "{",
    JSON.stringify({ v: 2 }),
    JSON.stringify({
      ...box.config,
      harnesses: { cursor: { ...box.binding, scope: "future" } },
    }),
    JSON.stringify({ ...box.config, intent: "../escape" }),
    JSON.stringify({
      ...box.config,
      harnesses: { cursor: { ...box.binding, digest: "bad" } },
    }),
    JSON.stringify({
      ...box.config,
      harnesses: { cursor: { ...box.binding, runtimeRoot: "../escape" } },
    }),
    JSON.stringify({
      ...box.config,
      harnesses: { cursor: { ...box.binding, runtimeRoot: box.runtime } },
    }),
    JSON.stringify({
      ...box.config,
      harnesses: { cursor: { ...box.binding, scope: "user" } },
    }),
  ]) {
    await box.box.write("project/vouch/config.json", config);
    const failure = ports(box.root, ["session", "project", box.root]);
    await launch(box.entry, failure.hooks);
    t.assert.equal(failure.seen.code, 0);
    t.assert.equal(failure.seen.calls.length, 0);
    t.assert.match(failure.seen.stderr, /VOUCH-LAUNCH/);
  }
  await box.box.write("project/vouch/config.json", JSON.stringify(box.config));
  for (const input of [Buffer.from("null"), Buffer.alloc(1024 * 1024)]) {
    const failure = ports(box.root, ["guard", "project", box.root]);
    failure.hooks.input = (async function* () {
      yield input;
    })();
    await launch(box.entry, failure.hooks);
    t.assert.equal(failure.seen.calls.length, 0);
    t.assert.equal(failure.seen.code, 0);
    t.assert.deepEqual(JSON.parse(failure.seen.stdout), {
      permission: "allow",
    });
  }
  const relative = ports("relative", ["doctor", "manual"]);
  await launch(box.entry, relative.hooks);
  t.assert.match(relative.seen.stderr, /ENV-CONFIG/);
  for (const args of [
    ["unknown", "manual"],
    ["doctor", "invalid"],
  ]) {
    const failure = ports(box.root, args);
    await launch(box.entry, failure.hooks);
    t.assert.match(failure.seen.stderr, /INSTALL-ARGS/);
  }
});
test("launcher preserves Claude and Codex native protocol and converts Cursor denials", async (t) => {
  for (const harness of ["claude", "codex", "cursor"]) {
    const box = await setup(
      t,
      /** @type {'claude'|'codex'|'cursor'} */ (harness),
    );
    const denial = ports(box.root, ["guard", "project", box.root], {
      status: 2,
      stdout: "",
      stderr: "protected",
    });
    await launch(box.entry, denial.hooks);
    t.assert.equal(denial.seen.code, harness === "cursor" ? 0 : 2);
    if (harness === "cursor")
      t.assert.deepEqual(JSON.parse(denial.seen.stdout), {
        permission: "deny",
        user_message: "protected",
      });
    else t.assert.equal(denial.seen.stderr, "protected");
  }
});
test("Cursor guard returns valid allow responses for active, inactive, absent and stale bindings and internal failures", async (t) => {
  const box = await setup(t);
  const configs = [
    JSON.stringify(box.config),
    JSON.stringify({ v: 1, harnesses: {} }),
    JSON.stringify({
      ...box.config,
      harnesses: {
        cursor: {
          ...box.binding,
          digest: "b".repeat(64),
          runtimeRoot: `.vouch/versions/${"b".repeat(64)}/cursor`,
        },
      },
    }),
    "{",
  ];
  for (const config of configs) {
    await box.box.write("project/vouch/config.json", config);
    const command = ports(box.root, ["guard", "project", box.root]);
    await launch(box.entry, command.hooks);
    t.assert.equal(command.seen.code, 0);
    t.assert.deepEqual(JSON.parse(command.seen.stdout), {
      permission: "allow",
    });
  }
  const absent = ports(box.box.root, ["guard", "user"]);
  await launch(box.entry, absent.hooks);
  t.assert.deepEqual(JSON.parse(absent.seen.stdout), { permission: "allow" });
  await box.box.write("project/vouch/config.json", JSON.stringify(box.config));
  const duplicate = ports(box.root, ["guard", "user"]);
  await launch(box.entry, duplicate.hooks);
  t.assert.equal(duplicate.seen.calls.length, 0);
  t.assert.deepEqual(JSON.parse(duplicate.seen.stdout), {
    permission: "allow",
  });
  const crashed = ports(box.root, ["guard", "project", box.root], {
    status: null,
    stdout: "",
    stderr: "process failed",
  });
  await launch(box.entry, crashed.hooks);
  t.assert.equal(crashed.seen.code, 0);
  t.assert.deepEqual(JSON.parse(crashed.seen.stdout), { permission: "allow" });
});
test("damaged descriptors preserve the native adapter and manual failure without executing a product", async (t) => {
  for (const harness of /** @type {const} */ (["cursor", "claude", "codex"])) {
    const box = await setup(t, harness);
    const path = `project/${box.binding.runtimeRoot}/registry/installation.json`;
    for (const text of [
      null,
      "{",
      "null",
      "{}",
      '{"harness":"unknown"}',
      JSON.stringify({ harness: harness === "cursor" ? "claude" : "cursor" }),
    ]) {
      if (text === null) await rm(box.box.path(path));
      else await box.box.write(path, text);
      for (const action of ["guard", "session", "prompt", "stop", "doctor"]) {
        const manual = action === "doctor";
        const command = ports(
          box.root,
          manual ? [action, "manual"] : [action, "project", box.root],
        );
        await launch(box.entry, command.hooks);
        t.assert.equal(command.seen.calls.length, 0);
        t.assert.equal(command.seen.code, manual ? 2 : 0);
        t.assert.match(command.seen.stderr, /VOUCH-LAUNCH/);
        if (!manual && harness === "cursor")
          t.assert.deepEqual(
            JSON.parse(command.seen.stdout),
            action === "guard"
              ? { permission: "allow" }
              : action === "prompt"
                ? { continue: true }
                : {},
          );
        else t.assert.equal(command.seen.stdout, "");
      }
    }
  }
});

test("Cursor prompt permission survives successful execution, inactive bindings, invalid input and internal failures", async (t) => {
  const box = await setup(t);
  const payload = JSON.stringify({
    hook_event_name: "beforeSubmitPrompt",
    conversation_id: "conversation",
    generation_id: "generation",
    prompt: "hello",
  });
  for (const config of [
    JSON.stringify(box.config),
    '{"v":1,"harnesses":{}}',
    "{",
  ]) {
    await box.box.write("project/vouch/config.json", config);
    for (const raw of [payload, "{", "{}"]) {
      const command = ports(box.root, ["prompt", "project", box.root]);
      command.hooks.input = (async function* () {
        yield Buffer.from(raw);
      })();
      await launch(box.entry, command.hooks);
      t.assert.equal(command.seen.code, 0);
      t.assert.deepEqual(JSON.parse(command.seen.stdout), { continue: true });
    }
  }
  await box.box.write("project/vouch/config.json", JSON.stringify(box.config));
  for (const scope of ["user", "project"]) {
    const command = ports(box.root, ["prompt", scope, box.root], {
      status: null,
      stdout: "",
      stderr: "internal failure",
    });
    command.hooks.input = (async function* () {
      yield Buffer.from(payload);
    })();
    await launch(box.entry, command.hooks);
    t.assert.equal(command.seen.code, 0);
    t.assert.deepEqual(JSON.parse(command.seen.stdout), { continue: true });
    t.assert.equal(command.seen.calls.length, scope === "project" ? 1 : 0);
  }
});

test("launcher I/O wrapper owns the process exit boundary", async (t) => {
  const previous = process.exitCode;
  await runLauncher(
    pathToFileURL("/nonexistent/hooks/vouch-launch.mjs").href,
    launch,
  );
  t.assert.equal(process.exitCode, 2);
  process.exitCode = previous;
});
