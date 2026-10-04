import { test } from "node:test";
import {
  executeProduct,
  nodeArguments,
} from "../../../core/hooks/lib/launch-process.mjs";

test("literal POSIX paths use fixed loader code with the entry and arguments kept as data", (t) => {
  const entry = "/tmp/home\\name/'$` runtime/entry.mjs";
  for (const platform of /** @type {const} */ (["linux", "win32"])) {
    const args = nodeArguments(entry, ["doctor", "manual"], platform);
    if (platform === "win32")
      t.assert.deepEqual(args, [entry, "doctor", "manual"]);
    else {
      t.assert.equal(args[0], "-e");
      t.assert.match(args[1] ?? "", /registerHooks/);
      t.assert.equal((args[1] ?? "").includes(entry), false);
      t.assert.deepEqual(args.slice(2), [entry, "doctor", "manual"]);
    }
  }
  t.assert.deepEqual(nodeArguments("/normal/entry.mjs", ["guard"], "linux"), [
    "/normal/entry.mjs",
    "guard",
  ]);
  t.assert.equal(
    nodeArguments("/entry.mjs", ["guard"], "linux", true)[0],
    "-e",
  );
});

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
