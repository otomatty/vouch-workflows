import { inspectInstallation } from "../../core/hooks/lib/doctor.mjs";
import { registration } from "../../core/hooks/lib/installation-ownership.mjs";
import {
  distributionDigest,
  runtimeContents,
} from "../../core/hooks/lib/installation-runtime.mjs";
import runtime from "../../core/registry/runtime.json" with { type: "json" };
import { managedOwned } from "./managed-ownership.mjs";
import { memoryFiles, sandbox } from "./runtime.mjs";

/** @param {import("node:test").TestContext} t */
export async function managedDoctor(t) {
  const box = await sandbox(t, { git: false });
  const expected = {
    version: 1,
    hooks: { sessionStart: [{ command: "node launcher session" }] },
  };
  const source = Object.fromEntries([
    ...runtime.files.map((path) => [`.cursor/${path}`, "source"]),
    ...runtime.assets.cursor.map((path) => [path, "source"]),
  ]);
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

  return { store, state, config, owned, active, inspect };
}
