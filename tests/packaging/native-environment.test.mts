import { performance } from "node:perf_hooks";
import { test } from "node:test";
import {
  nativeEnvironment,
  probeNode,
} from "../../scripts/lib/native-environment.mjs";
import { sandbox } from "../helpers/runtime.mjs";

const scope = {
  home: "C:/isolated/home",
  project: "C:/isolated/project",
  intent: "260928-native-review",
};

test("isolated Windows environment preserves executable lookup without inheriting credentials", (t) => {
  const source = {
    pAtH: "C:/node;C:/Windows",
    pAtHeXt: ".COM;.EXE;.BAT;.CMD",
    SystemRoot: "C:/Windows",
    TEMP: "C:/Temp",
    OPENAI_API_KEY: "not-a-real-key",
    HTTPS_PROXY: "not-a-real-proxy",
    NODE_OPTIONS: "--invalid",
    TERM: "dumb",
    CODEX_HOME: "C:/personal",
    VOUCH_INTENT: "personal",
  };
  const before = { ...source };
  const env = nativeEnvironment(source, scope, "win32");
  t.plan(2);
  t.assert.deepEqual(env, {
    PATH: source.pAtH,
    PATHEXT: source.pAtHeXt,
    SYSTEMROOT: source.SystemRoot,
    TEMP: source.TEMP,
    CODEX_HOME: scope.home,
    VOUCH_PROJECT_ROOT: scope.project,
    VOUCH_INTENT: scope.intent,
    VOUCH_HARNESS: "claude",
  });
  t.assert.deepEqual(source, before);
});

test("isolated environment rejects missing lookup variables before starting a CLI", (t) => {
  t.plan(4);
  for (const env of [
    { PATHEXT: ".EXE" },
    { PATH: "" },
    { PATH: "C:/node" },
    { PATH: "C:/node", PATHEXT: ".CMD;.BAT" },
  ])
    t.assert.throws(() => nativeEnvironment(env, scope, "win32"), /NATIVE-ENV/);
});

test("isolated POSIX environment keeps case-sensitive lookup and replaces the home", (t) => {
  const posix = {
    home: "/tmp/native/home",
    project: "/tmp/native/project",
    intent: scope.intent,
  };
  t.plan(2);
  t.assert.deepEqual(
    nativeEnvironment(
      {
        PATH: "/usr/bin",
        Path: "/ignored",
        HOME: "/personal",
        LANG: "C.UTF-8",
        NODE_OPTIONS: "--invalid",
      },
      posix,
      "linux",
    ),
    {
      PATH: "/usr/bin",
      LANG: "C.UTF-8",
      HOME: posix.home,
      CODEX_HOME: posix.home,
      VOUCH_PROJECT_ROOT: posix.project,
      VOUCH_INTENT: posix.intent,
      VOUCH_HARNESS: "claude",
    },
  );
  t.assert.throws(
    () =>
      nativeEnvironment(
        { PATH: "/usr/bin" },
        { ...posix, home: "relative" },
        "linux",
      ),
    /NATIVE-ENV/,
  );
});

test("isolated shell resolves named node and reports its real version", async (t) => {
  const box = await sandbox(t);
  const env = nativeEnvironment(process.env, {
    home: box.path("home"),
    project: box.root,
    intent: scope.intent,
  });
  t.plan(1);
  t.assert.match(probeNode(env), /^v\d+\.\d+\.\d+$/);
});

test("node preflight rejects a shell that cannot resolve node before the probe timeout", async (t) => {
  const box = await sandbox(t);
  const env = nativeEnvironment(process.env, {
    home: box.path("home"),
    project: box.root,
    intent: scope.intent,
  });
  env.PATH = box.root;
  t.plan(2);
  const started = performance.now();
  t.assert.throws(() => probeNode(env), /NATIVE-NODE/);
  // A lookup that only ends at the 4 s spawn timeout is not a resolution failure.
  const elapsed = performance.now() - started;
  t.assert.equal(elapsed < 4000, true, `${elapsed.toFixed(1)} ms`);
});
