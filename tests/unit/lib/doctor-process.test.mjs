import { test } from "node:test";
import { gitStatus } from "../../../core/hooks/lib/doctor-process.mjs";

test("Git probe executes only version without a shell and bounds its duration", (t) => {
  t.plan(3);
  const result = gitStatus((command, args, options) => {
    t.assert.deepEqual([command, args], ["git", ["--version"]]);
    t.assert.deepEqual(options, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 1500,
    });
    return { status: 0, stdout: "git version test\n" };
  });
  t.assert.deepEqual(result, { ok: true, detail: "git version test" });
});

test("Git probe reports missing binaries timeouts and empty failed output", (t) => {
  t.plan(3);
  for (const response of [
    { status: null, error: new Error("timeout") },
    { status: 1 },
    { status: 0, stdout: "" },
  ]) {
    t.assert.equal(gitStatus(() => response).ok, false);
  }
});
