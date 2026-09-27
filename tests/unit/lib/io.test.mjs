import { Readable } from "node:stream";
import { test } from "node:test";
import { run } from "../../../core/hooks/lib/io.mjs";
import { readJson } from "../../helpers/registry.mjs";
import {
  fakeClock,
  memoryFiles,
  promptFor,
  sandbox,
} from "../../helpers/runtime.mjs";

/** @param {string|Uint8Array} text */
function ports(text) {
  const output = { stdout: "", stderr: "", code: -1 };
  const options = {
    context: {
      projectRoot: process.cwd(),
      harness: /** @type {const} */ ("claude"),
      generation: "test",
      ...fakeClock(),
    },
    stdin: (async function* () {
      yield text;
    })(),
    stdout: {
      write: (/** @type {string} */ text) => {
        output.stdout += text;
      },
    },
    stderr: {
      write: (/** @type {string} */ text) => {
        output.stderr += text;
      },
    },
    finish: (/** @type {0|2} */ code) => {
      output.code = code;
    },
    files: memoryFiles(),
  };
  return { output, options };
}

test("io shares the configured intent store between the handler and event persistence", async (t) => {
  const port = ports(JSON.stringify(promptFor(process.cwd()).payload));
  const sample = readJson("tests/fixtures/audit/hook.check.jsonl");
  t.plan(3);
  await run(
    async (_input, ctx) => {
      t.assert.equal(await ctx.audit?.find?.(sample.id), undefined);
      return { decision: "allow", events: [sample] };
    },
    { ...port.options, context: { ...port.options.context, intent: "scope" } },
  );
  t.assert.equal(port.output.stderr, "");
  t.assert.equal(
    port.options.files.data.get("vouch/intents/scope/audit/events.jsonl"),
    JSON.stringify(sample) + "\n",
  );
});

test("io validates input before main, and reports deny with exit 2", async (t) => {
  const input = promptFor(process.cwd()).payload;
  const allowed = ports(
    Buffer.from(JSON.stringify({ ...input, future: true })),
  );
  t.plan(5);
  await run(async (value, context) => {
    t.assert.equal("future" in value, false);
    t.assert.equal(context.generation, "test");
    return { decision: "allow" };
  }, allowed.options);
  t.assert.deepEqual(allowed.output, { stdout: "", stderr: "", code: 0 });
  const denied = ports(JSON.stringify(input));
  await run(
    async () => ({ decision: "deny", reason: "approval required" }),
    denied.options,
  );
  t.assert.equal(denied.output.stderr, "approval required\n");
  t.assert.equal(denied.output.code, 2);
});

test("io checks tool paths, preserves tool fields, and handles non-Error failures", async (t) => {
  const base = promptFor(process.cwd()).payload;
  const cases = [
    { file_path: "safe.txt", future: "kept" },
    { file_path: 7 },
    { command: "pwd" },
  ];
  t.plan(5);
  for (const tool_input of cases) {
    const port = ports(
      JSON.stringify({
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input,
      }),
    );
    await run(async (input) => {
      t.assert.deepEqual("tool_input" in input && input.tool_input, tool_input);
      return { decision: "allow", events: [] };
    }, port.options);
    t.assert.equal(
      port.output.stderr.includes("HOOK-14"),
      typeof tool_input.file_path === "number",
    );
  }
});

test("io contains stream failures and primitive exceptions", async (t) => {
  const raw = JSON.stringify(promptFor(process.cwd()).payload);
  const primitive = ports(raw);
  const broken = ports(raw);
  const closed = ports(raw);
  t.plan(4);
  await run(async () => Promise.reject("primitive failure"), primitive.options);
  t.assert.match(primitive.output.stderr, /HOOK-2: primitive failure/);
  broken.options.stdin = (async function* () {
    yield "";
    throw new Error("input failure");
  })();
  await run(async () => ({ decision: "allow" }), broken.options);
  t.assert.match(broken.output.stderr, /input failure/);
  closed.options.stderr.write = () => {
    throw new Error("closed");
  };
  await run(
    async () => ({ decision: "deny", reason: "blocked" }),
    closed.options,
  );
  t.assert.equal(closed.output.code, 0);
  t.assert.equal(closed.output.stdout, "");
});

test("io defaults use trusted environment, stdin, stderr and process exit status", async (t) => {
  const box = await sandbox(t, { git: false });
  const saved = Object.getOwnPropertyDescriptor(process, "stdin");
  const oldCode = process.exitCode;
  const oldRoot = process.env.VOUCH_PROJECT_ROOT,
    oldHarness = process.env.VOUCH_HARNESS;
  t.after(() => {
    if (saved) Object.defineProperty(process, "stdin", saved);
    process.exitCode = oldCode;
    if (oldRoot === undefined) delete process.env.VOUCH_PROJECT_ROOT;
    else process.env.VOUCH_PROJECT_ROOT = oldRoot;
    if (oldHarness === undefined) delete process.env.VOUCH_HARNESS;
    else process.env.VOUCH_HARNESS = oldHarness;
  });
  process.env.VOUCH_PROJECT_ROOT = box.root;
  process.env.VOUCH_HARNESS = "claude";
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: Readable.from([
      Buffer.from(JSON.stringify(promptFor(box.root).payload)),
    ]),
  });
  let called = false;
  await run(async () => {
    called = true;
    return { decision: "allow" };
  });
  t.plan(2);
  t.assert.equal(called, true);
  t.assert.equal(process.exitCode, 0);
});

test("io fails open without invoking main for malformed and oversized input", async (t) => {
  const payload = promptFor(process.cwd()).payload;
  const cases = [
    "",
    "not json",
    "{}",
    JSON.stringify({ ...payload, prompt: 3 }),
    "x".repeat(1024 * 1024),
  ];
  t.plan(cases.length * 3);
  for (const raw of cases) {
    const port = ports(raw);
    await run(async () => {
      t.assert.fail("main must not run");
      return { decision: "allow" };
    }, port.options);
    t.assert.equal(port.output.code, 0);
    t.assert.equal(port.output.stdout, "");
    t.assert.match(port.output.stderr, /HOOK-14/);
  }
});

test("io catches path, handler, response, missing audit and persistence failures", async (t) => {
  const payload = JSON.stringify(promptFor(process.cwd()).payload);
  /** @type {{main:import('../../../core/hooks/lib/contracts.mjs').HookMain,error:string}[]} */
  const cases = [
    {
      main: async () => {
        throw new Error("handler");
      },
      error: "handler",
    },
    {
      main: async () => /** @type {never} */ ({ decision: "wrong" }),
      error: "HOOK-3",
    },
    {
      main: async () => ({
        decision: "allow",
        events: [readJson("tests/fixtures/audit/hook.check.jsonl")],
      }),
      error: "AUDIT-MISSING",
    },
  ];
  t.plan(cases.length * 3 + 4);
  for (const item of cases) {
    const port = ports(payload);
    await run(item.main, port.options);
    t.assert.equal(port.output.code, 0);
    t.assert.equal(port.output.stdout, "");
    t.assert.match(port.output.stderr, new RegExp(`HOOK-2.*${item.error}`));
  }
  const path = ports(payload);
  path.options.files.resolvePath = async () => {
    throw new Error("FS-ESCAPE");
  };
  await run(async () => {
    t.assert.fail("path must reject");
    return { decision: "allow" };
  }, path.options);
  t.assert.match(path.output.stderr, /FS-ESCAPE/);
  const failed = ports(payload);
  await run(/** @type {NonNullable<typeof cases[2]>} */ (cases[2]).main, {
    ...failed.options,
    audit: {
      append: async () => {
        throw new Error("disk");
      },
    },
  });
  t.assert.match(failed.output.stderr, /disk/);
  t.assert.equal(failed.output.code, 0);
  const success = ports(payload);
  const events = [];
  await run(/** @type {NonNullable<typeof cases[2]>} */ (cases[2]).main, {
    ...success.options,
    audit: {
      append: async (values) => {
        events.push(...values);
        return "appended";
      },
    },
  });
  t.assert.equal(events.length, 1);
});
