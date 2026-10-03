import { test } from "node:test";
import { executeProduct } from "../../../core/hooks/lib/launch-process.mjs";

test("process launcher passes only trusted selection and never builds a shell command", (t) => {
  const selected = {
    projectRoot: "/project",
    runtimeRoot: "/runtime",
    harness: /** @type {const} */ ("cursor"),
    intent: "scope",
  };
  /** @type {unknown[]} */ const calls = [];
  const execute = /** @type {typeof import('node:child_process').spawnSync} */ (
    (...args) => {
      calls.push(args);
      return { status: 0, stdout: "out", stderr: "err" };
    }
  );
  t.assert.deepEqual(
    executeProduct(
      "/runtime/hooks/entry.mjs",
      ["literal $ '"],
      "stdin",
      selected,
      execute,
    ),
    { status: 0, stdout: "out", stderr: "err" },
  );
  const call =
    /** @type {[string,string[],{cwd:string,env:Record<string,string>,shell?:boolean}]} */ (
      calls[0]
    );
  t.assert.deepEqual(call[1], ["/runtime/hooks/entry.mjs", "literal $ '"]);
  t.assert.equal(call[2].env.VOUCH_HARNESS, "cursor");
  t.assert.equal(call[2].cwd, "/project");
  t.assert.equal(call[2].shell, undefined);
  const fail = /** @type {typeof import('node:child_process').spawnSync} */ (
    /** @type {unknown} */ (() => ({ error: new Error("spawn failed") }))
  );
  t.assert.throws(
    () => executeProduct("entry", [], "", selected, fail),
    /spawn failed/,
  );
});
