import { mkdir, symlink } from "node:fs/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runLauncher } from "../../../core/hooks/lib/io.mjs";
import { launch } from "../../../core/hooks/lib/launch.mjs";
import { sandbox } from "../../helpers/runtime.mjs";

const hash = "a".repeat(64);
async function setup(
  t: import("node:test").TestContext,
  harness: "claude" | "codex" | "cursor" = "cursor",
) {
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
function ports(
  root: string,
  args: string[],
  result: { status: number | null; stdout: string; stderr: string } = {
    status: 0,
    stdout: "",
    stderr: "",
  },
) {
  const seen = {
    stdout: "",
    stderr: "",
    code: 0,
    calls: [] as unknown[][],
  };
  const hooks = {
    environment: { projectRoot: root, explicit: false, args },
    stdout: {
      write: (text: string) => {
        seen.stdout += text;
      },
    },
    stderr: {
      write: (text: string) => {
        seen.stderr += text;
      },
    },
    finish: (code: number) => {
      seen.code = code;
    },
    execute: (
      entry: string,
      words: string[],
      input: string,
      selected: unknown,
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
test("launcher ascends cwd, skips inactive projects and stale registrations, and has no user hooks", async (t) => {
  const box = await setup(t);
  await mkdir(box.box.path("project/src"));
  const nested = ports(box.box.path("project/src"), ["doctor", "manual"]);
  await launch(box.entry, nested.hooks);
  t.assert.equal(nested.seen.calls.length, 1);
  const skipped = ports(box.root, ["session", "project", box.box.root]);
  await launch(box.entry, skipped.hooks);
  t.assert.equal(skipped.seen.calls.length, 0);
  t.assert.equal(skipped.seen.stdout, "{}\n");
  // Design D3: user installations register no hooks, so the scope does not exist.
  const user = ports(box.root, ["session", "user"]);
  await launch(box.entry, user.hooks);
  t.assert.equal(user.seen.calls.length, 0);
  t.assert.match(user.seen.stderr, /INSTALL-ARGS/);
  const inactive = ports(box.box.root, ["doctor", "manual"]);
  await launch(box.entry, inactive.hooks);
  t.assert.equal(inactive.seen.code, 2);
  await box.box.write(
    "project/vouch/config.json",
    JSON.stringify({ v: 1, harnesses: {} }),
  );
  const otherHarness = ports(box.root, ["session", "project", box.root]);
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
test("the launcher runs only its own runtime, compares it by real path and takes the Intent from configuration", async (t) => {
  const box = await setup(t);
  // A checkout opened through a link still selects this runtime.
  await symlink(box.root, box.box.path("alias"), "junction");
  const alias = box.box.path("alias");
  const linked = ports(alias, ["session", "project", alias]);
  Object.assign(linked.hooks.environment, { intent: "injected" });
  await launch(box.entry, linked.hooks);
  t.assert.equal(linked.seen.calls.length, 1, linked.seen.stderr);
  t.assert.equal(
    (linked.seen.calls[0]?.[3] as { intent: string }).intent,
    "scope",
  );
  // Configuration naming another runtime never executes that runtime's code.
  const other = `.vouch/versions/${"c".repeat(64)}/cursor`;
  await box.box.write(`project/${other}/hooks/vouch-statusline.mjs`, "");
  await box.box.write(
    "project/vouch/config.json",
    JSON.stringify({
      ...box.config,
      harnesses: {
        cursor: { ...box.binding, digest: "c".repeat(64), runtimeRoot: other },
      },
    }),
  );
  for (const args of [
    ["statusline", "manual"],
    ["session", "project", box.root],
  ]) {
    const refused = ports(box.root, args);
    await launch(box.entry, refused.hooks);
    t.assert.equal(refused.seen.calls.length, 0, args.join(" "));
  }
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
    const box = await setup(t, harness as "claude" | "codex" | "cursor");
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
test("every Cursor path answers with a schema-valid permission or continue response", async (t) => {
  const box = await setup(t);
  const event = (fields: Record<string, unknown>) =>
    (async function* () {
      yield Buffer.from(
        JSON.stringify({ conversation_id: "conversation", ...fields }),
      );
    })();
  const allowed = ports(box.root, ["guard", "project", box.root]);
  await launch(box.entry, allowed.hooks);
  t.assert.deepEqual(JSON.parse(allowed.seen.stdout), { permission: "allow" });
  const prompt = ports(box.root, ["prompt", "project", box.root]);
  prompt.hooks.input = event({
    hook_event_name: "beforeSubmitPrompt",
    prompt: "hello",
  });
  await launch(box.entry, prompt.hooks);
  t.assert.deepEqual(JSON.parse(prompt.seen.stdout), { continue: true });
  const empty = ports(box.root, ["stop", "project", box.root]);
  empty.hooks.input = event({ hook_event_name: "afterAgentResponse" });
  await launch(box.entry, empty.hooks);
  t.assert.equal(empty.seen.calls.length, 0, "no answer is recorded");
  t.assert.deepEqual(JSON.parse(empty.seen.stdout), {});
  t.assert.equal(empty.seen.stderr, "");
  // Inactive projects, invalid activation and an unreadable descriptor still answer.
  await box.box.write("project/vouch/config.json", "{");
  for (const [action, expected] of [
    ["guard", { permission: "allow" }],
    ["prompt", { continue: true }],
  ] as const) {
    const failed = ports(box.root, [action, "project", box.root]);
    await launch(box.entry, failed.hooks);
    t.assert.deepEqual(JSON.parse(failed.seen.stdout), expected);
  }
  await box.box.write(
    `project/.vouch/versions/${hash}/cursor/registry/installation.json`,
    "missing harness",
  );
  const broken = ports(box.root, ["guard", "project", box.root]);
  await launch(box.entry, broken.hooks);
  t.assert.deepEqual(JSON.parse(broken.seen.stdout), { permission: "allow" });
  t.assert.match(broken.seen.stderr, /VOUCH-LAUNCH/);
});
test("launcher I/O wrapper owns the process exit boundary", async (t) => {
  const previous = process.exitCode;
  await runLauncher(pathToFileURL("/nonexistent/hooks/vouch-launch.mjs").href);
  t.assert.equal(process.exitCode, 2);
  process.exitCode = previous;
});
