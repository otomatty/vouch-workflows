import { test } from "node:test";
import { executeProduct } from "../../../core/hooks/lib/launch-process.mjs";

test("process launcher passes only trusted selection and never builds a shell command", (t) => {
  const selected = {
    projectRoot: "/project",
    runtimeRoot: "/runtime",
    harness: "cursor" as const,
    intent: "scope",
  };
  const calls: unknown[] = [];
  const execute = ((...args) => {
    calls.push(args);
    return { status: 0, stdout: "out", stderr: "err" };
  }) as typeof import("node:child_process").spawnSync;
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
  const call = calls[0] as [
    string,
    string[],
    { cwd: string; env: Record<string, string>; shell?: boolean },
  ];
  t.assert.deepEqual(call[1], ["/runtime/hooks/entry.mjs", "literal $ '"]);
  t.assert.equal(call[2].env.VOUCH_HARNESS, "cursor");
  t.assert.equal(call[2].cwd, "/project");
  t.assert.equal(call[2].shell, undefined);
  const fail = (() => ({
    error: new Error("spawn failed"),
  })) as unknown as typeof import("node:child_process").spawnSync;
  t.assert.throws(
    () => executeProduct("entry", [], "", selected, fail),
    /spawn failed/,
  );
});
