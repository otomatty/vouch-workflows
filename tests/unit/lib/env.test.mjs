import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  childEnvironment,
  readArgs,
  readContext,
  readDoctorContext,
  readIntent,
  readLaunchEnvironment,
  readSecrets,
} from "../../../core/hooks/lib/env.mjs";

test("managed environment keeps runtime and project roots separate for all three harnesses", (t) => {
  const root = resolve("project");
  const runtime = resolve("user/.vouch/versions/hash/cursor");
  const selected = {
    projectRoot: root,
    runtimeRoot: runtime,
    harness: /** @type {const} */ ("cursor"),
    intent: "scope",
  };
  const env = childEnvironment(selected, {
    KEEP: "value",
    VOUCH_HARNESS: "claude",
  });
  t.assert.equal(env.KEEP, "value");
  t.assert.equal(readContext(env).harness, "cursor");
  t.assert.deepEqual(
    readDoctorContext(pathToFileURL(`${runtime}/hooks/entry.mjs`).href, env),
    {
      projectRoot: root,
      installationRoot: "",
      runtimeRoot: runtime,
      harness: "cursor",
      nodeVersion: process.versions.node,
    },
  );
  t.assert.equal(
    readLaunchEnvironment(
      { CURSOR_PROJECT_DIR: root },
      ["node", "entry", "session"],
      "/cwd",
    ).projectRoot,
    root,
  );
  t.assert.equal(
    readLaunchEnvironment({}, ["node", "entry"], "/cwd").explicit,
    false,
  );
  t.assert.equal(
    readLaunchEnvironment({}, ["node", "entry"], "/cwd").cwd,
    "/cwd",
  );
  t.assert.equal(
    readLaunchEnvironment(
      { VOUCH_PROJECT_ROOT: "", CLAUDE_PROJECT_DIR: root, VOUCH_INTENT: "" },
      ["node", "entry"],
      "/cwd",
    ).projectRoot,
    "",
  );
  t.assert.equal(
    readLaunchEnvironment(
      { CLAUDE_PROJECT_DIR: root },
      ["node", "entry"],
      "/cwd",
    ).explicit,
    true,
  );
});

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

test("manual commands read their arguments after the entry path", (t) => {
  t.plan(2);
  t.assert.deepEqual(
    readArgs(["node", "/x/vouch-question.mjs", "ask", "Q-1"]),
    ["ask", "Q-1"],
  );
  t.assert.deepEqual(readArgs(["node"]), []);
});

test("manual commands read secret-named variable values of a minimum length, longest first", (t) => {
  const rule = { names: "TOKEN|SECRET", minLength: 8 };
  process.env.VOUCH_UNIT_SECRET = "from-the-process";
  const own = readSecrets(rule);
  delete process.env.VOUCH_UNIT_SECRET;
  t.plan(2);
  t.assert.deepEqual(
    readSecrets(rule, {
      GH_TOKEN: "abcdefgh",
      my_secret: "abcdefghij",
      SHORT_TOKEN: "abcdefg",
      EMPTY_TOKEN: undefined,
      PATH: "/usr/local/bin:/usr/bin",
    }),
    ["abcdefghij", "abcdefgh"],
  );
  t.assert.equal(own.includes("from-the-process"), true);
});
