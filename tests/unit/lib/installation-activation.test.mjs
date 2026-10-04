import { resolve } from "node:path";
import { test } from "node:test";
import { verifyManagedActivation } from "../../../core/hooks/lib/installation-activation.mjs";
import { registration as generatedRegistration } from "../../../core/hooks/lib/installation-registration.mjs";
import {
  distributionDigest,
  runtimeContents,
} from "../../../core/hooks/lib/installation-runtime.mjs";
import runtime from "../../../core/registry/runtime.json" with { type: "json" };
import { managedOwned } from "../../helpers/managed-ownership.mjs";
import { memoryFiles } from "../../helpers/runtime.mjs";

/** @param {'project'|'user'} [scope] @param {'claude'|'codex'|'cursor'} [harness] */
function setup(scope = "project", harness = "claude") {
  const source = Object.fromEntries(
    runtime.files.map((path) => [`.${harness}/${path}`, "content"]),
  );
  source["AGENTS.md"] = "content";
  source[`.${harness}/registry/runtime.json`] = JSON.stringify(runtime);
  let activationOwned = managedOwned(harness);
  for (const entry of activationOwned)
    if (entry.kind === "file" && !entry.path.includes("/rules/"))
      source[entry.path] = entry.content;
  const digest = distributionDigest(source);
  const canonical = `.vouch/versions/${digest}/${harness}`;
  const projectRoot = resolve("project");
  const runtimeRoot = resolve(
    scope === "project" ? projectRoot : "home",
    canonical,
  );
  const storedRoot = scope === "project" ? canonical : runtimeRoot;
  activationOwned = managedOwned(harness, storedRoot);
  const registration = generatedRegistration(
    harness,
    runtimeRoot,
    "project",
    projectRoot,
  );
  const registrationPath = `.${harness}/${harness === "claude" ? "settings" : "hooks"}.json`;
  const state = {
    v: 1,
    harness,
    scope,
    digest,
    runtimeRoot: storedRoot,
    owned: [
      ...activationOwned,
      {
        kind: "hooks",
        path: registrationPath,
        content: JSON.stringify(registration),
        previous: null,
      },
    ],
  };
  const config = {
    v: 1,
    harnesses: {
      [harness]: {
        scope,
        digest,
        runtimeRoot: storedRoot,
        registrationScope: "project",
      },
    },
  };
  const statePath = `.vouch/${scope === "project" ? "installations" : "bindings"}/${harness}.json`;
  const files = memoryFiles({
    ...Object.fromEntries(
      activationOwned
        .filter((entry) => entry.kind !== "toml")
        .map((entry) => [entry.path, entry.content]),
    ),
    [statePath]: JSON.stringify(state),
    "vouch/config.json": JSON.stringify(config),
    [registrationPath]: JSON.stringify(registration),
    ...(harness === "codex"
      ? {
          ".codex/config.toml":
            "[features]\nhooks = true\n[agents]\nmax_depth = 3\n",
        }
      : {}),
  });
  const installation = memoryFiles({
    ...runtimeContents(source, harness, storedRoot),
    ...Object.fromEntries(
      Object.entries(source).map(([path, text]) => [
        `distribution/${path}`,
        text,
      ]),
    ),
  });
  const environment = {
    projectRoot,
    runtimeRoot,
    installationRoot: "",
    harness,
    nodeVersion: "24.19.0",
  };
  return {
    files,
    installation,
    environment,
    statePath,
    state,
    config,
    registrationPath,
  };
}

test("managed activation validation observes either scope and existing Codex enabled settings without writes", async (t) => {
  for (const scope of ["project", "user"])
    for (const harness of ["claude", "codex", "cursor"]) {
      const box = setup(
        /** @type {'project'|'user'} */ (scope),
        /** @type {'claude'|'codex'|'cursor'} */ (harness),
      );
      const before = [new Map(box.files.data), new Map(box.installation.data)];
      t.assert.match(
        await verifyManagedActivation(
          box.files,
          box.installation,
          box.environment,
        ),
        /managed runtime/,
      );
      t.assert.deepEqual([box.files.data, box.installation.data], before);
    }
});

test("missing descriptors, identity mismatch, noncanonical roots and lost owned files are rejected without writes", async (t) => {
  for (const variant of [
    "missing",
    "version",
    "harness",
    "scope",
    "digest",
    "root-type",
    "config",
    "selection",
    "path",
    "hooks",
    "entry",
    "entry-path",
    "lost-file",
    "missing-archive",
  ]) {
    const box = setup();
    if (variant === "missing") box.files.data.delete(box.statePath);
    else {
      if (variant === "version") box.state.v = 2;
      if (variant === "harness") box.state.harness = "codex";
      if (variant === "scope")
        box.files.data.set(
          box.statePath,
          JSON.stringify({ ...box.state, scope: "user" }),
        );
      if (variant === "digest") box.state.digest = "invalid";
      if (variant === "root-type")
        box.files.data.set(
          box.statePath,
          JSON.stringify({ ...box.state, runtimeRoot: 123 }),
        );
      if (variant === "path") box.state.runtimeRoot = ".vouch/another";
      if (variant === "hooks") box.state.owned = [];
      if (variant === "entry")
        box.files.data.set(
          box.statePath,
          JSON.stringify({ ...box.state, owned: [...box.state.owned, null] }),
        );
      if (variant === "entry-path")
        box.files.data.set(
          box.statePath,
          JSON.stringify({
            ...box.state,
            owned: [...box.state.owned, { path: 123 }],
          }),
        );
      if (!["scope", "root-type", "entry", "entry-path"].includes(variant))
        box.files.data.set(box.statePath, JSON.stringify(box.state));
      if (variant === "config") box.files.data.set("vouch/config.json", "{}");
      if (variant === "selection")
        box.files.data.set(
          "vouch/config.json",
          JSON.stringify({
            ...box.config,
            harnesses: {
              claude: {
                ...box.config.harnesses.claude,
                runtimeRoot: ".vouch/another",
              },
            },
          }),
        );
      if (variant === "lost-file") box.files.data.delete(box.registrationPath);
      if (variant === "missing-archive") box.installation.data.clear();
    }
    const before = [new Map(box.files.data), new Map(box.installation.data)];
    await t.assert.rejects(
      verifyManagedActivation(box.files, box.installation, box.environment),
    );
    t.assert.deepEqual([box.files.data, box.installation.data], before);
  }
});

test("matching user paths still require canonical version suffixes and Codex enabled hooks", async (t) => {
  const user = setup("user");
  const changed = resolve("home/noncanonical");
  user.environment.runtimeRoot = changed;
  user.state.runtimeRoot = changed;
  const activation = user.config.harnesses.claude;
  if (!activation) throw new Error("missing fixture activation");
  activation.runtimeRoot = changed;
  user.files.data.set(user.statePath, JSON.stringify(user.state));
  user.files.data.set("vouch/config.json", JSON.stringify(user.config));
  await t.assert.rejects(
    verifyManagedActivation(user.files, user.installation, user.environment),
    /runtime path differs/,
  );
  const codex = setup("project", "codex");
  codex.files.data.set(
    ".codex/config.toml",
    "[features]\nhooks = false\n[agents]\nmax_depth = 3\n",
  );
  await t.assert.rejects(
    verifyManagedActivation(codex.files, codex.installation, codex.environment),
    /Codex hooks/,
  );
});

test("every harness and scope requires each activation entry exactly once with its expected kind", async (t) => {
  for (const scope of ["project", "user"])
    for (const harness of ["claude", "codex", "cursor"]) {
      const original = setup(
        /** @type {'project'|'user'} */ (scope),
        /** @type {'claude'|'codex'|'cursor'} */ (harness),
      );
      const entries = original.state.owned;
      const variants = [
        ...entries.map((_entry, index) =>
          entries.filter((_item, at) => at !== index),
        ),
        [...entries, entries[0]],
        entries.map((entry, index) =>
          index === 0 ? { ...entry, kind: "hooks" } : entry,
        ),
        entries.map((entry, index) =>
          index === 0 ? { ...entry, path: ".other/owned" } : entry,
        ),
        entries.map((entry, index) => (index === 0 ? null : entry)),
      ];
      for (const owned of variants) {
        original.files.data.set(
          original.statePath,
          JSON.stringify({ ...original.state, owned }),
        );
        const before = [
          new Map(original.files.data),
          new Map(original.installation.data),
        ];
        await t.assert.rejects(
          verifyManagedActivation(
            original.files,
            original.installation,
            original.environment,
          ),
          /ownership manifest/,
        );
        t.assert.deepEqual(
          [original.files.data, original.installation.data],
          before,
        );
      }
    }
});
