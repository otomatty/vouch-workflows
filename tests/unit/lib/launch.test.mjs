import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runLauncher } from "../../../core/hooks/lib/io.mjs";
import { launch } from "../../../core/hooks/lib/launch.mjs";
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
      /** @type {{intent:string}|undefined} */ (command.seen.calls[0]?.[3])?.intent,
      "",
    );
  }
});
test("native statusline quietly skips inactive projects and renders the selected runtime", async (t) => {
  const box = await setup(t, "claude");
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
  }
  box.binding.digest = "b".repeat(64);
  box.binding.runtimeRoot = `.vouch/versions/${box.binding.digest}/claude`;
  await box.box.write("project/vouch/config.json", JSON.stringify(box.config));
  const pinned = ports(box.root, ["statusline", "user"]);
  await launch(box.entry, pinned.hooks);
  t.assert.equal(
    pinned.seen.calls[0]?.[0],
    box.box.path(
      `project/${box.binding.runtimeRoot}/hooks/vouch-statusline.mjs`,
    ),
  );
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
        decision: "deny",
        reason: "protected",
      });
    else t.assert.equal(denial.seen.stderr, "protected");
  }
});
test("launcher I/O wrapper owns the process exit boundary", async (t) => {
  const previous = process.exitCode;
  await runLauncher(pathToFileURL("/nonexistent/hooks/vouch-launch.mjs").href);
  t.assert.equal(process.exitCode, 2);
  process.exitCode = previous;
});
