import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runLauncher } from "../../../core/hooks/lib/io.mjs";
import { launch } from "../../../core/hooks/lib/launch.mjs";
import { ports, setup } from "../../helpers/launch.mjs";

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
test("launcher ascends cwd, skips inactive and stale project hooks, and keeps unverified user replacements active", async (t) => {
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
    t.assert.equal(skipped.seen.calls.length, args[1] === "user" ? 1 : 0);
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
  t.assert.equal(duplicate.seen.calls.length, 1);
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
    t.assert.equal(command.seen.calls.length, 1);
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

test("every harness keeps trusted user code active when a claimed replacement is absent or has an invalid descriptor", async (t) => {
  for (const harness of /** @type {const} */ (["claude", "codex", "cursor"])) {
    const box = await setup(t, harness);
    box.binding.digest = "b".repeat(64);
    box.binding.runtimeRoot = `.vouch/versions/${box.binding.digest}/${harness}`;
    await box.box.write(
      "project/vouch/config.json",
      JSON.stringify(box.config),
    );
    for (const descriptor of [
      undefined,
      "null",
      JSON.stringify({ harness: "unknown" }),
    ]) {
      if (descriptor !== undefined)
        await box.box.write(
          `project/${box.binding.runtimeRoot}/registry/installation.json`,
          descriptor,
        );
      const command = ports(box.root, ["guard", "user"], {
        status: 2,
        stdout: "",
        stderr: "trusted guard denied",
      });
      await launch(box.entry, command.hooks);
      t.assert.equal(command.seen.calls.length, 1);
      t.assert.equal(
        command.seen.calls[0]?.[0],
        join(box.runtime, "hooks/vouch-guard-writes.mjs"),
      );
      if (harness === "cursor")
        t.assert.equal(JSON.parse(command.seen.stdout).permission, "deny");
      else t.assert.equal(command.seen.code, 2);
    }
  }
});
