import { test } from "node:test";
import { inspectInstallation } from "../../../core/hooks/lib/doctor.mjs";
import runtime from "../../../core/registry/runtime.json" with { type: "json" };
import { validator } from "../../helpers/registry.mjs";
import { memoryFiles, sandbox } from "../../helpers/runtime.mjs";

test("managed doctor inspects the selected runtime separately and detects missing or duplicate native registration", async (t) => {
  const box = await sandbox(t, { git: false });
  const digest = "a".repeat(64);
  const prefix = `.vouch/versions/${digest}/cursor`;
  const runtimeRoot = box.path(prefix);
  for (const path of runtime.files)
    await box.write(`${prefix}/${path}`, "source");
  const expected = {
    version: 1,
    hooks: { sessionStart: [{ command: "node launcher session" }] },
  };
  await box.write(
    `${prefix}/registry/installation.json`,
    JSON.stringify({ harness: "cursor", registration: "hooks.json" }),
  );
  await box.write(
    `${prefix}/registry/registration.json`,
    JSON.stringify(expected),
  );
  await box.write(`${prefix}/hooks.json`, JSON.stringify(expected));
  const store = memoryFiles({ ".cursor/hooks.json": JSON.stringify(expected) });
  const owned = {
    kind: "hooks",
    path: ".cursor/hooks.json",
    content: JSON.stringify(expected),
    previous: null,
  };
  const state = {
    v: 1,
    harness: "cursor",
    scope: "project",
    digest,
    runtimeRoot: prefix,
    owned: [owned],
  };
  const config = {
    v: 1,
    harnesses: {
      cursor: {
        scope: "project",
        digest,
        runtimeRoot: prefix,
        registrationScope: "project",
      },
    },
  };
  store.data.set("vouch/config.json", JSON.stringify(config));
  store.data.set(".vouch/installations/cursor.json", JSON.stringify(state));
  const managed = {
    projectRoot: box.root,
    installationRoot: "",
    runtimeRoot,
    harness: /** @type {const} */ ("cursor"),
    nodeVersion: "24.19.0",
  };
  const inspect = () =>
    inspectInstallation(store, managed, { ok: true, detail: "git" });
  t.assert.equal((await inspect()).ok, true);
  store.data.set(
    ".cursor/hooks.json",
    JSON.stringify({
      ...expected,
      hooks: {
        sessionStart: [
          ...expected.hooks.sessionStart,
          ...expected.hooks.sessionStart,
        ],
      },
    }),
  );
  t.assert.equal((await inspect()).ok, false);
  store.data.set(".cursor/hooks.json", "{}");
  t.assert.equal((await inspect()).ok, false);
  for (const value of [
    "null",
    JSON.stringify({ ...state, owned: [] }),
    JSON.stringify({ ...state, owned: [{ ...owned, content: "null" }] }),
  ]) {
    store.data.set(".vouch/installations/cursor.json", value);
    t.assert.equal((await inspect()).ok, false);
  }
  store.data.set(".cursor/hooks.json", JSON.stringify(expected));
  for (const identity of [
    { scope: "user" },
    { digest: "f".repeat(64) },
    { runtimeRoot: "alternate" },
    { digest: 1 },
    { runtimeRoot: null },
  ]) {
    store.data.set(
      ".vouch/installations/cursor.json",
      JSON.stringify({ ...state, ...identity }),
    );
    t.assert.equal((await inspect()).ok, false);
  }
  store.data.set(".vouch/installations/cursor.json", JSON.stringify(state));
  for (const invalid of [
    null,
    {},
    { ...config, harnesses: [] },
    { ...config, harnesses: { cursor: null } },
    {
      ...config,
      harnesses: {
        cursor: { ...config.harnesses.cursor, runtimeRoot: "alternate" },
      },
    },
  ]) {
    store.data.set("vouch/config.json", JSON.stringify(invalid));
    t.assert.equal((await inspect()).ok, false);
  }
  store.data.set("vouch/config.json", JSON.stringify(config));
  t.assert.equal((await inspect()).ok, true);
  store.data.delete(".vouch/installations/cursor.json");
  t.assert.equal((await inspect()).ok, false);
});

const environment = {
  projectRoot: "/project",
  installationRoot: "install",
  nodeVersion: "22.19.0",
};
const reference = {
  env: { VOUCH_HARNESS: "claude" },
  hooks: {
    SessionStart: [
      {
        matcher: "startup",
        hooks: [{ type: "command", command: "node", args: ["entry.mjs"] }],
      },
    ],
  },
};
function files() {
  return memoryFiles({
    ...Object.fromEntries(
      runtime.files.map((path) => [`install/${path}`, "source"]),
    ),
    "install/registry/installation.json": JSON.stringify({
      harness: "claude",
      registration: "settings.json",
    }),
    "install/registry/registration.json": JSON.stringify(reference),
    "install/settings.json": JSON.stringify(reference),
  });
}

test("doctor reports the supported runtime and registration without modifying any files", async (t) => {
  const store = files();
  const before = new Map(store.data);
  const report = await inspectInstallation(store, environment, {
    ok: true,
    detail: "git version test",
  });
  t.plan(4);
  t.assert.equal(report.ok, true);
  t.assert.equal(validator("doctor-report")(report), true);
  t.assert.equal(report.checks.length, runtime.files.length + 4);
  t.assert.deepEqual(store.data, before);
});

test("doctor checks exact Node minimum and preserves Git failures", async (t) => {
  const versions = [
    ["22.18.9", false],
    ["22.19.0", true],
    ["22.19.1", true],
    ["24.0.0", true],
    ["22.19.0-rc.1", false],
    ["bad", false],
  ];
  t.plan(versions.length * 2);
  for (const [version, expected] of versions) {
    const report = await inspectInstallation(
      files(),
      { ...environment, nodeVersion: String(version) },
      { ok: false, detail: "git unavailable" },
    );
    t.assert.equal(
      report.checks.find((check) => check.id === "DOCTOR-NODE")?.ok,
      expected,
    );
    t.assert.equal(
      report.checks.find((check) => check.id === "DOCTOR-GIT")?.ok,
      false,
    );
  }
});

test("doctor accepts unrelated settings but rejects lost commands and changed ordered args", async (t) => {
  const variants = [
    [
      {
        ...reference,
        model: "custom",
        hooks: { ...reference.hooks, Stop: [] },
      },
      true,
    ],
    [
      {
        ...reference,
        hooks: {
          SessionStart: [
            { matcher: "other", hooks: [] },
            ...reference.hooks.SessionStart,
          ],
        },
      },
      true,
    ],
    [{ ...reference, hooks: {} }, false],
    [{ ...reference, env: { VOUCH_HARNESS: "codex" } }, false],
    [
      {
        ...reference,
        hooks: {
          SessionStart: [
            {
              matcher: "startup",
              hooks: [
                {
                  type: "command",
                  command: "node",
                  args: ["extra", "entry.mjs"],
                },
              ],
            },
          ],
        },
      },
      false,
    ],
    [null, false],
    [[], false],
  ];
  t.plan(variants.length);
  for (const [value, expected] of variants) {
    const store = files();
    store.data.set("install/settings.json", JSON.stringify(value));
    const report = await inspectInstallation(store, environment, {
      ok: true,
      detail: "Git",
    });
    t.assert.equal(report.ok, expected);
  }
});

test("doctor reports missing malformed linked and escaped inputs without trusting metadata paths", async (t) => {
  const cases = [
    ["install/hooks/lib/fs.mjs", null],
    ["install/settings.json", "not json"],
    ["install/registry/registration.json", null],
    ["install/registry/registration.json", "null"],
    ["install/registry/installation.json", "null"],
    ["install/registry/installation.json", "[]"],
    [
      "install/registry/installation.json",
      JSON.stringify({ harness: "unknown", registration: "settings.json" }),
    ],
    [
      "install/registry/installation.json",
      JSON.stringify({ harness: "claude", registration: "../outside.json" }),
    ],
    [
      "install/registry/installation.json",
      JSON.stringify({
        harness: "codex",
        registration: "hooks.json",
        configuration: "../outside.toml",
      }),
    ],
  ];
  t.plan(cases.length + 2);
  for (const [path, value] of cases) {
    const store = files();
    if (value === null) store.data.delete(String(path));
    else store.data.set(String(path), String(value));
    t.assert.equal(
      (
        await inspectInstallation(store, environment, {
          ok: true,
          detail: "Git",
        })
      ).ok,
      false,
    );
  }
  for (const error of [new Error("FS-LINK"), "disk failure"]) {
    const store = files();
    store.readText = async () => {
      throw error;
    };
    t.assert.equal(
      (
        await inspectInstallation(store, environment, {
          ok: true,
          detail: "Git",
        })
      ).ok,
      false,
    );
  }
});

test("Codex configuration presence is reported without claiming TOML semantic verification", async (t) => {
  const store = files();
  store.data.set(
    "install/registry/installation.json",
    JSON.stringify({
      harness: "codex",
      registration: "settings.json",
      configuration: "config.toml",
    }),
  );
  t.plan(4);
  for (const text of [null, "sandbox_mode = 'workspace-write'"]) {
    if (text !== null) store.data.set("install/config.toml", text);
    const report = await inspectInstallation(store, environment, {
      ok: true,
      detail: "Git",
    });
    t.assert.equal(report.ok, text !== null);
    t.assert.match(
      report.checks.at(-1)?.detail ?? "",
      text === null ? /missing/ : /not validated/,
    );
  }
});
