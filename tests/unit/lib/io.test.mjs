import { test } from "node:test";
import { run } from "../../../core/hooks/lib/io.mjs";
import { readJson } from "../../helpers/registry.mjs";
import { fakeClock, memoryFiles, promptFor } from "../../helpers/runtime.mjs";

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
  await run(cases[2].main, {
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
  await run(cases[2].main, {
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
