import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { withLock } from "../../scripts/lib/install-files.mjs";
import { installedText } from "../../scripts/lib/install-registration.mjs";
import { distribution, installRun } from "../helpers/install.mjs";
import { sandbox } from "../helpers/runtime.mjs";

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
    t.assert.ok(error.includes(lock));
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
  let owner;
  withLock(box.root, () => {
    owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
  });
  t.assert.equal(owner.pid, process.pid);
  t.assert.ok(Number.isFinite(Date.parse(owner.startedAt)));
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
  t.assert.ok(rendered.includes(`\`\` ${runtime}/registry/workflow.json \`\``));
  const bad = installRun("install", box, "cursor", "user", [
    "--home",
    box.path("home\ninjected"),
  ]);
  t.assert.equal(bad.status, 2, bad.stdout);
  t.assert.match(bad.stdout, /INSTALL-PATH/);
  await t.assert.rejects(
    box.read("home\ninjected/.vouch/installations/cursor.json"),
    { code: "ENOENT" },
  );
});
