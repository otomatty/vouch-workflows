import { resolve } from "node:path";
import { test } from "node:test";
import { readContext } from "../../../core/hooks/lib/env.mjs";

test("context requires trusted root and a supported installed harness", (t) => {
  t.plan(5);
  for (const source of [
    {},
    { VOUCH_PROJECT_ROOT: "relative", VOUCH_HARNESS: "claude" },
    { VOUCH_PROJECT_ROOT: resolve("."), VOUCH_HARNESS: "other" },
  ])
    t.assert.throws(() => readContext(source), /ENV-CONFIG/);
  const context = readContext({
    VOUCH_PROJECT_ROOT: resolve("."),
    VOUCH_HARNESS: "claude",
    VOUCH_GENERATION: "test",
  });
  t.assert.deepEqual(
    [context.projectRoot, context.harness, context.generation],
    [resolve("."), "claude", "test"],
  );
  t.assert.equal(
    readContext({ VOUCH_PROJECT_ROOT: resolve("."), VOUCH_HARNESS: "codex" })
      .generation,
    "untracked",
  );
});
test("context reads only configured runtime environment values", (t) => {
  const keys = ["VOUCH_PROJECT_ROOT", "VOUCH_HARNESS", "VOUCH_GENERATION"];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      const value = before[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.VOUCH_PROJECT_ROOT = resolve(".");
  process.env.VOUCH_HARNESS = "codex";
  delete process.env.VOUCH_GENERATION;
  const context = readContext();
  t.plan(3);
  t.assert.equal(context.harness, "codex");
  t.assert.match(context.now(), /^\d{4}-\d{2}-\d{2}T/);
  t.assert.match(context.newId("s", "i"), /^evt_/);
});
