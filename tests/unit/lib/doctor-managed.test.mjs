import { test } from "node:test";
import { inspectInstallation } from "../../../core/hooks/lib/doctor.mjs";
import { registration } from "../../../core/hooks/lib/installation-ownership.mjs";
import {
  distributionDigest,
  runtimeContents,
} from "../../../core/hooks/lib/installation-runtime.mjs";
import runtime from "../../../core/registry/runtime.json" with { type: "json" };
import { managedOwned } from "../../helpers/managed-ownership.mjs";
import { memoryFiles, sandbox } from "../../helpers/runtime.mjs";

test("managed doctor inspects the selected runtime separately and detects missing or duplicate native registration", async (t) => {
  const box = await sandbox(t, { git: false });
  const expected = {
    version: 1,
    hooks: { sessionStart: [{ command: "node launcher session" }] },
  };
  const source = Object.fromEntries(
    runtime.files.map((path) => [`.cursor/${path}`, "source"]),
  );
  source["AGENTS.md"] = "source";
  source[".cursor/registry/runtime.json"] = JSON.stringify(runtime);
  source[".cursor/registry/installation.json"] = JSON.stringify({
    harness: "cursor",
    registration: "hooks.json",
  });
  source[".cursor/registry/registration.json"] = JSON.stringify(expected);
  let activationOwned = managedOwned("cursor");
  for (const entry of activationOwned)
    if (entry.kind === "file" && !entry.path.includes("/rules/"))
      source[entry.path] = entry.content;
  const digest = distributionDigest(source);
  const prefix = `.vouch/versions/${digest}/cursor`;
  const runtimeRoot = box.path(prefix);
  for (const [path, text] of Object.entries(
    runtimeContents(source, "cursor", prefix),
  ))
    await box.write(`${prefix}/${path}`, text);
  for (const [path, text] of Object.entries(source))
    await box.write(`${prefix}/distribution/${path}`, text);
  await box.write(`${prefix}/hooks.json`, JSON.stringify(expected));
  activationOwned = managedOwned("cursor", prefix);
  const active = JSON.parse(
    JSON.stringify(registration("cursor", runtimeRoot, "project", box.root)),
  );
  const store = memoryFiles({
    ...Object.fromEntries(
      activationOwned.map((entry) => [entry.path, entry.content]),
    ),
    ".cursor/hooks.json": JSON.stringify(active),
  });
  const owned = {
    kind: "hooks",
    path: ".cursor/hooks.json",
    content: JSON.stringify(active),
    previous: null,
  };
  const state = {
    v: 1,
    harness: "cursor",
    scope: "project",
    digest,
    runtimeRoot: prefix,
    owned: [...activationOwned, owned],
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
      ...active,
      hooks: {
        sessionStart: [
          ...active.hooks.sessionStart,
          ...active.hooks.sessionStart,
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
  store.data.set(".cursor/hooks.json", JSON.stringify(active));
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
