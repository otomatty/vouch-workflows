import { spawnSync } from "node:child_process";
import fs, { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { remove } from "../../scripts/lib/install.mjs";
import { withLock } from "../../scripts/lib/install-files.mjs";
import { installedText } from "../../scripts/lib/install-registration.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("failed project removal preserves user state even when one project restoration is denied", async (t) => {
  const box = await sandbox(t);
  distribution(t, box);
  await box.write("project/AGENTS.md", "existing guidance\n");
  t.assert.equal(installRun("install", box, "cursor", "user").status, 0);
  t.assert.equal(installRun("init", box, "cursor", "user").status, 0);
  const paths = [
    "home/.vouch/installations/cursor.json",
    "home/.cursor/hooks.json",
    "project/vouch/config.json",
    "project/.cursor/hooks.json",
    "project/.vouch/bindings/cursor.json",
  ];
  const before = await Promise.all(paths.map((path) => box.read(path)));
  const agents = await box.read("project/AGENTS.md");
  const original = fs.renameSync;
  let failed = false;
  const mocked = t.mock.method(
    fs,
    "renameSync",
    (
      /** @type {import('node:fs').PathLike} */ source,
      /** @type {import('node:fs').PathLike} */ target,
    ) => {
      if (target === box.path("project/vouch/config.json")) {
        failed = true;
        throw new Error("activation write denied");
      }
      if (failed && target === box.path("project/AGENTS.md"))
        throw new Error("guidance restoration denied");
      return original(source, target);
    },
  );
  syncBuiltinESMExports();
  try {
    t.assert.throws(
      () =>
        remove({
          harness: "cursor",
          scope: "user",
          home: box.path("home"),
          project: box.path("project"),
          projectExplicit: true,
          dist: box.path("dist"),
        }),
      (error) => {
        t.assert.match(String(error), /INSTALL-ROLLBACK/);
        t.assert.match(String(error), /activation write denied/);
        t.assert.equal(
          String(error).includes(box.path("project/AGENTS.md")),
          true,
        );
        return true;
      },
    );
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
  t.assert.deepEqual(
    await Promise.all(paths.map((path) => box.read(path))),
    before,
  );
  t.assert.equal(await box.read("project/AGENTS.md"), "existing guidance\n");
  // Repair the explicitly reported file; the retained user state permits retry.
  await box.write("project/AGENTS.md", agents);
  const retry = installRun("remove", box, "cursor", "user");
  t.assert.equal(retry.status, 0, retry.stdout);
  await t.assert.rejects(box.read("home/.vouch/installations/cursor.json"), {
    code: "ENOENT",
  });
});

test("user removal changes only an explicitly named project and holds both locks", async (t) => {
  const box = await sandbox(t);
  distribution(t, box);
  t.assert.equal(installRun("install", box, "cursor", "user").status, 0);
  t.assert.equal(installRun("init", box, "cursor", "user").status, 0);
  const files = [
    "vouch/config.json",
    "AGENTS.md",
    ".cursor/hooks.json",
    ".vouch/bindings/cursor.json",
  ];
  const before = await Promise.all(
    files.map((path) => box.read(`project/${path}`)),
  );
  const implicit = spawnSync(
    process.execPath,
    [
      resolve("scripts/vouch.mjs"),
      "remove",
      "--harness",
      "cursor",
      "--scope",
      "user",
      "--home",
      box.path("home"),
    ],
    { cwd: box.path("project"), encoding: "utf8" },
  );
  t.assert.equal(implicit.status, 0, implicit.stdout);
  t.assert.deepEqual(
    await Promise.all(files.map((path) => box.read(`project/${path}`))),
    before,
  );
  t.assert.equal(installRun("install", box, "cursor", "user").status, 0);
  const userState = await box.read("home/.vouch/installations/cursor.json");
  await mkdir(box.path("project/.vouch/install.lock"));
  const conflict = installRun("remove", box, "cursor", "user");
  t.assert.equal(conflict.status, 2, conflict.stdout);
  t.assert.match(conflict.stdout, /INSTALL-LOCK/);
  t.assert.equal(
    await box.read("home/.vouch/installations/cursor.json"),
    userState,
  );
  t.assert.deepEqual(
    await Promise.all(files.map((path) => box.read(`project/${path}`))),
    before,
  );
  await rm(box.path("project/.vouch/install.lock"), { recursive: true });
  const removed = installRun("remove", box, "cursor", "user");
  t.assert.equal(removed.status, 0, removed.stdout);
  t.assert.equal(
    JSON.parse(await box.read("project/vouch/config.json")).harnesses.cursor,
    undefined,
  );
});

test("user removal recognizes home case aliases while preserving a distinct home binding", async (t) => {
  const box = await sandbox(t);
  distribution(t, box);
  t.assert.equal(installRun("install", box, "cursor", "user").status, 0);
  t.assert.equal(installRun("init", box, "cursor", "user").status, 0);
  const home = box.path("HOME");
  const alias = existsSync(join(home, ".vouch/installations/cursor.json"));
  if (!alias)
    t.assert.equal(
      installRun("install", box, "cursor", "user", ["--home", home]).status,
      0,
    );
  const before = await box.read("project/vouch/config.json");
  const result = installRun("remove", box, "cursor", "user", ["--home", home]);
  t.assert.equal(result.status, 0, result.stdout);
  if (alias)
    t.assert.equal(
      JSON.parse(await box.read("project/vouch/config.json")).harnesses.cursor,
      undefined,
    );
  else t.assert.equal(await box.read("project/vouch/config.json"), before);
});

test("installation lock records its owner and gives safe manual recovery guidance", async (t) => {
  const box = await sandbox(t);
  const lock = box.path(".vouch/install.lock");
  withLock(box.root, () => {
    const conflict = spawnSync(
      process.execPath,
      [
        resolve("scripts/vouch.mjs"),
        "remove",
        "--harness",
        "cursor",
        "--scope",
        "project",
        "--project",
        box.root,
      ],
      { encoding: "utf8" },
    );
    const error = JSON.parse(conflict.stdout).error;
    t.assert.match(error, /INSTALL-LOCK/);
    t.assert.equal(error.includes(lock), true);
    t.assert.match(error, /no installer is running/);
  });
  await t.assert.rejects(box.read(".vouch/install.lock/owner.json"), {
    code: "ENOENT",
  });
  await mkdir(lock);
  await box.write(
    ".vouch/install.lock/owner.json",
    '{"pid":999999,"startedAt":"2026-10-03T00:00:00Z"}',
  );
  t.assert.throws(() => withLock(box.root, () => {}), /INSTALL-LOCK/);
  t.assert.match(await box.read(".vouch/install.lock/owner.json"), /999999/);
  await rm(lock, { recursive: true });
  const owner = withLock(box.root, () =>
    JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")),
  );
  t.assert.equal(owner.pid, process.pid);
  t.assert.equal(Number.isFinite(Date.parse(owner.startedAt)), true);
});

test("lock creation preserves filesystem errors that are not lock conflicts", async (t) => {
  const box = await sandbox(t);
  const lock = box.path(".vouch/install.lock");
  const original = fs.mkdirSync;
  const denied = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  const mocked = t.mock.method(
    fs,
    "mkdirSync",
    (
      /** @type {string} */ path,
      /** @type {import('node:fs').MakeDirectoryOptions} */ options,
    ) => {
      if (path === lock) throw denied;
      return original(path, options);
    },
  );
  syncBuiltinESMExports();
  try {
    t.assert.throws(
      () => withLock(box.root, () => {}),
      (error) => error === denied,
    );
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test("activation guidance encodes Markdown paths and refuses control characters before installation", async (t) => {
  const box = await sandbox(t);
  distribution(t, box);
  const home = box.path(
    process.platform === "win32"
      ? "home ) [injected] # `"
      : "home > ) [injected] # `",
  );
  const installed = installRun("install", box, "cursor", "user", [
    "--home",
    home,
  ]);
  t.assert.equal(installed.status, 0, installed.stdout);
  const runtime = JSON.parse(installed.stdout).runtimeRoot.replaceAll(
    "\\",
    "/",
  );
  t.assert.equal(
    installRun("init", box, "cursor", "user", ["--home", home]).status,
    0,
  );
  const agents = await box.read("project/AGENTS.md");
  const rule = await box.read("project/.cursor/rules/vouch.mdc");
  for (const text of [agents, rule]) {
    const target = text.match(/\]\(<([^>]+)>\)/)?.[1];
    t.assert.equal(decodeURIComponent(target ?? ""), `${runtime}/AGENTS.md`);
    t.assert.equal(text.includes("[injected]"), false);
  }
  const rendered = installedText(
    "[rules](.cursor/templates/ja/rules.md) and `.cursor/registry/workflow.json`",
    "cursor",
    runtime,
  );
  const destination = rendered.match(/\]\(<([^>]+)>\)/)?.[1];
  t.assert.equal(
    decodeURIComponent(destination ?? ""),
    `${runtime}/templates/ja/rules.md`,
  );
  t.assert.equal(
    rendered.includes(`\`\` ${runtime}/registry/workflow.json \`\``),
    true,
  );
  const bad = installRun("install", box, "cursor", "user", [
    "--home",
    box.path("home\ninjected"),
  ]);
  t.assert.equal(bad.status, 2, bad.stdout);
  t.assert.match(bad.stdout, /INSTALL-PATH/);
  t.assert.equal((await readdir(box.root)).includes("home\ninjected"), false);
});

test("corrupt distribution descriptor paths cannot overwrite project files or omit their snapshots", async (t) => {
  const box = await sandbox(t);
  distribution(t, box);
  await box.write("project/README.md", "existing project content\n");
  const path = "dist/codex/.codex/registry/installation.json";
  const original = JSON.parse(await box.read(path));
  for (const bad of [
    { registration: "../../../../README.md" },
    { configuration: "../../../../README.md" },
    { registration: "missing-hooks.json" },
    { configuration: "missing-config.toml" },
    { registration: null },
    { configuration: null },
  ]) {
    await box.write(path, JSON.stringify({ ...original, ...bad }));
    const result = installRun("install", box, "codex", "project");
    t.assert.equal(result.status, 2, result.stdout);
    t.assert.match(result.stdout, /INSTALL-(PATH|SOURCE)/);
    t.assert.equal(
      await box.read("project/README.md"),
      "existing project content\n",
    );
    await t.assert.rejects(
      box.read("project/.vouch/installations/codex.json"),
      { code: "ENOENT" },
    );
  }
});
