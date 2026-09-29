import { resolve } from "node:path";
import { test } from "node:test";
import { readContext, readIntent } from "../../../core/hooks/lib/env.mjs";

test("Claude uses its exported project root only when an explicit root is absent", (t) => {
  const root = resolve(".");
  const base = { VOUCH_HARNESS: "claude", CLAUDE_PROJECT_DIR: root };
  t.plan(7);
  t.assert.equal(readContext(base).projectRoot, root);
  t.assert.equal(
    readContext({ ...base, VOUCH_PROJECT_ROOT: resolve("..") }).projectRoot,
    resolve(".."),
  );
  for (const invalid of ["", "relative"]) {
    t.assert.throws(
      () => readContext({ ...base, VOUCH_PROJECT_ROOT: invalid }),
      /ENV-CONFIG/,
    );
    t.assert.throws(
      () => readContext({ ...base, CLAUDE_PROJECT_DIR: invalid }),
      /ENV-CONFIG/,
    );
  }
  t.assert.throws(
    () => readContext({ ...base, VOUCH_HARNESS: "codex" }),
    /ENV-CONFIG/,
  );
});

test("context reads optional intent scope only from installed environment", (t) => {
  const base = { VOUCH_PROJECT_ROOT: resolve("."), VOUCH_HARNESS: "claude" };
  t.plan(2);
  t.assert.equal(
    readContext({ ...base, VOUCH_INTENT: "scope" }).intent,
    "scope",
  );
  t.assert.equal(readContext({ ...base, VOUCH_INTENT: "" }).intent, undefined);
});

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

test("doctor context derives its target from its entry URL rather than caller environment", async (t) => {
  const { readDoctorContext } = await import("../../../core/hooks/lib/env.mjs");
  const { pathToFileURL } = await import("node:url");
  const root = resolve("doctor project $ '");
  t.plan(1);
  t.assert.deepEqual(
    readDoctorContext(
      pathToFileURL(resolve(root, "install/hooks/vouch-doctor.mjs")).href,
    ),
    {
      projectRoot: root,
      installationRoot: "install",
      nodeVersion: process.versions.node,
    },
  );
});

test("manual commands read the configured Intent only from the environment", (t) => {
  t.plan(3);
  t.assert.equal(
    readIntent({ VOUCH_INTENT: "260929-orders" }),
    "260929-orders",
  );
  t.assert.equal(readIntent({ VOUCH_INTENT: "" }), null);
  t.assert.equal(readIntent({ VOUCH_HARNESS: "claude" }), null);
});
