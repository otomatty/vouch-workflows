import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  commitChanges,
  digest,
  files,
  inside,
  read,
  withLock,
} from "./install-files.mjs";
import { plan, readInstallation } from "./install-plan.mjs";
import {
  installedText,
  markdownDestination,
  nativeDirectory,
  registration,
  registrationPath,
  skillsDirectory,
} from "./install-registration.mjs";
import { json, object, pretty } from "./install-settings.mjs";
import { enableCodex } from "./install-toml.mjs";

/** @typedef {{harness:string,scope:string,home:string,project:string,projectExplicit:boolean,dist:string,intent?:string}} Options */
/** @param {string} harness */
const statePath = (harness) => `.vouch/installations/${harness}.json`;
/** @param {Options} options */
const scopeRoot = (options) =>
  options.scope === "user" ? options.home : options.project;
/** @param {Record<string,string>} source */
const sourceDigest = (source) =>
  digest(
    Object.keys(source)
      .sort()
      .map((path) => `${JSON.stringify(path)}:${digest(source[path] ?? "")}\n`)
      .join(""),
  );

/** @param {Options} options @param {'install'|'update'} command */
export function install(options, command) {
  const root = scopeRoot(options);
  return withLock(root, () => {
    const prior = readInstallation(
      read(inside(root, statePath(options.harness))),
    );
    if (command === "update" && !prior)
      throw new Error("INSTALL-MISSING: scope is not installed");
    const source = files(join(options.dist, options.harness));
    const hash = sourceDigest(source);
    const runtimeRelative = `.vouch/versions/${hash}/${options.harness}`;
    const runtimeRoot = inside(root, runtimeRelative);
    const referenceRoot =
      options.scope === "project" ? runtimeRelative : runtimeRoot;
    const prefix = `${nativeDirectory(options.harness)}/`;
    if (!source[`${prefix}registry/installation.json`])
      throw new Error("INSTALL-SOURCE: incomplete distribution");
    const inventory = json(source[`${prefix}registry/runtime.json`] ?? null);
    if (!Array.isArray(inventory.files) || !source["AGENTS.md"])
      throw new Error("INSTALL-SOURCE: runtime inventory or guidance missing");
    for (const path of inventory.files)
      if (typeof path !== "string" || !source[`${prefix}${path}`])
        throw new Error(`INSTALL-SOURCE: missing runtime ${String(path)}`);
    const bindingPath = `.vouch/bindings/${options.harness}.json`;
    const binding =
      options.scope === "project"
        ? readInstallation(read(inside(root, bindingPath)))
        : null;
    const changes = plan(root, prior ?? binding);
    if (binding) changes.put(bindingPath, null);
    for (const [path, content] of Object.entries(source)) {
      const archive = `${runtimeRelative}/distribution/${path}`;
      const existing = changes.current(archive);
      if (existing !== null && existing !== content)
        throw new Error(`INSTALL-CONFLICT: immutable distribution ${path}`);
      changes.put(archive, content);
      if (
        path === "AGENTS.md" ||
        path.startsWith(`${prefix}hooks/`) ||
        path.startsWith(`${prefix}registry/`) ||
        path.startsWith(`${prefix}templates/`)
      ) {
        const target = `${runtimeRelative}/${path === "AGENTS.md" ? path : path.slice(prefix.length)}`;
        const text = path.endsWith(".md")
          ? installedText(content, options.harness, referenceRoot)
          : content;
        const before = changes.current(target);
        if (before !== null && before !== text)
          throw new Error(`INSTALL-CONFLICT: immutable runtime ${target}`);
        changes.put(target, text);
      } else if (
        path.startsWith(`${skillsDirectory(options.harness)}/`) ||
        path.startsWith(`${prefix}agents/`)
      ) {
        changes.file(
          path,
          path.endsWith(".md") || path.endsWith(".toml")
            ? installedText(content, options.harness, referenceRoot)
            : content,
        );
      }
    }
    // Keep a distribution registration snapshot for runtime doctor; native registration is checked by setup doctor.
    const descriptor = json(
      source[`${prefix}registry/installation.json`] ?? null,
    );
    for (const key of ["registration", "configuration"])
      if (typeof descriptor[key] === "string")
        changes.put(
          `${runtimeRelative}/${descriptor[key]}`,
          source[`${prefix}${descriptor[key]}`] ?? "",
        );
    changes.hooks(
      registrationPath(options.harness),
      registration(
        options.harness,
        runtimeRoot,
        options.scope,
        options.scope === "project" ? options.project : undefined,
      ),
    );
    if (options.harness === "codex") changes.codex(".codex/config.toml");
    /** @type {import('./install-plan.mjs').Installation} */
    const state = {
      v: 1,
      harness: options.harness,
      scope: options.scope,
      digest: hash,
      runtimeRoot: runtimeRelative,
      owned: changes.owned,
    };
    if (options.scope === "project")
      activate(changes, options, state, runtimeRoot);
    changes.put(statePath(options.harness), pretty(state));
    commitChanges([...changes.changes.values()]);
    return {
      v: 1,
      ok: true,
      harness: options.harness,
      scope: options.scope,
      digest: hash,
      runtimeRoot,
    };
  });
}

/** @param {ReturnType<import('./install-plan.mjs').plan>} changes @param {Options} options
 * @param {import('./install-plan.mjs').Installation} state @param {string} runtimeRoot */
function activate(changes, options, state, runtimeRoot) {
  const referenceRoot =
    state.scope === "project"
      ? relative(options.project, runtimeRoot).replaceAll("\\", "/")
      : runtimeRoot.replaceAll("\\", "/");
  const config = json(changes.current("vouch/config.json"));
  if (config.v !== undefined && config.v !== 1)
    throw new Error("INSTALL-CONFIG: unsupported project configuration");
  if (config.harnesses !== undefined && !object(config.harnesses))
    throw new Error("INSTALL-CONFIG: harnesses must be an object");
  const harnesses = {
    .../** @type {Record<string,unknown>} */ (config.harnesses ?? {}),
  };
  harnesses[options.harness] = {
    scope: state.scope,
    digest: state.digest,
    runtimeRoot:
      state.scope === "project"
        ? relative(options.project, runtimeRoot).replaceAll("\\", "/")
        : runtimeRoot,
    registrationScope: "project",
  };
  changes.put(
    "vouch/config.json",
    pretty({
      ...config,
      v: 1,
      harnesses,
      ...(options.intent === undefined ? {} : { intent: options.intent }),
    }),
  );
  changes.document(
    "AGENTS.md",
    options.harness,
    `Vouch を ${options.harness} で利用する時は、選択した本体の [共通ルール](${markdownDestination(`${referenceRoot}/AGENTS.md`)}) を読む。規則と成果物はこのプロジェクトの vouch/ に保存する。`,
  );
  if (options.harness === "claude")
    changes.document("CLAUDE.md", options.harness, "@AGENTS.md");
  if (options.harness === "cursor")
    changes.file(
      ".cursor/rules/vouch.mdc",
      `---\ndescription: Vouch workflow activation\nalwaysApply: true\n---\nRead [Vouch rules](${markdownDestination(`${referenceRoot}/AGENTS.md`)}) when using Vouch in this project.`,
    );
}

/** @param {Options} options */
export function initialize(options) {
  return withLock(options.project, () => {
    const local = readInstallation(
      read(inside(options.project, statePath(options.harness))),
    );
    const global = readInstallation(
      read(inside(options.home, statePath(options.harness))),
    );
    const selected = local ?? global;
    if (!selected)
      throw new Error(
        "INSTALL-MISSING: install a project or user runtime first",
      );
    const runtimeRoot = inside(
      local ? options.project : options.home,
      selected.runtimeRoot,
    );
    const bindingPath = `.vouch/bindings/${options.harness}.json`;
    const binding = readInstallation(
      read(inside(options.project, bindingPath)),
    );
    const changes = plan(options.project, binding);
    if (local) {
      // The project installation already owns its activation documents and registration.
      const config = json(changes.current("vouch/config.json"));
      if (options.intent !== undefined) config.intent = options.intent;
      changes.put("vouch/config.json", pretty(config));
    } else {
      const source = files(join(runtimeRoot, "distribution"));
      if (sourceDigest(source) !== selected.digest)
        throw new Error("INSTALL-VERSION: distribution has changed");
      for (const [path, text] of Object.entries(source))
        if (
          path.startsWith(`${skillsDirectory(options.harness)}/`) ||
          path.startsWith(`${nativeDirectory(options.harness)}/agents/`)
        )
          changes.file(path, installedText(text, options.harness, runtimeRoot));
      changes.hooks(
        registrationPath(options.harness),
        registration(options.harness, runtimeRoot, "project", options.project),
      );
      if (options.harness === "codex") changes.codex(".codex/config.toml");
      activate(changes, options, selected, runtimeRoot);
      changes.put(
        bindingPath,
        pretty({ ...selected, owned: changes.owned, runtimeRoot }),
      );
    }
    commitChanges([...changes.changes.values()]);
    return {
      v: 1,
      ok: true,
      harness: options.harness,
      scope: selected.scope,
      digest: selected.digest,
      runtimeRoot,
    };
  });
}

/** @param {Options} options */
export function remove(options) {
  const root = scopeRoot(options);
  return withLock(root, () => {
    const local = readInstallation(
      read(inside(root, statePath(options.harness))),
    );
    const bindingPath = `.vouch/bindings/${options.harness}.json`;
    const binding =
      options.scope === "project" && !local
        ? readInstallation(read(inside(root, bindingPath)))
        : null;
    const state = local ?? binding;
    if (!state) throw new Error("INSTALL-MISSING: scope is not installed");
    const changes = plan(root, state);
    changes.put(local ? statePath(options.harness) : bindingPath, null);
    if (options.scope === "project") deactivate(changes, options.harness);
    // Explicitly named project bindings are removed; other projects keep their pinned version.
    const finish = () => {
      commitChanges([...changes.changes.values()]);
      return { v: 1, ok: true, harness: options.harness, scope: options.scope };
    };
    if (options.scope === "user" && options.projectExplicit) {
      const removeBinding = () => {
        const path = `.vouch/bindings/${options.harness}.json`;
        const binding = readInstallation(read(inside(options.project, path)));
        if (
          binding &&
          binding.runtimeRoot ===
            inside(
              options.home,
              `.vouch/versions/${binding.digest}/${options.harness}`,
            )
        ) {
          const project = plan(options.project, binding);
          deactivate(project, options.harness);
          project.put(path, null);
          for (const [key, change] of project.changes)
            changes.changes.set(`project:${key}`, change);
        }
        return finish();
      };
      return options.project === root
        ? removeBinding()
        : withLock(options.project, removeBinding);
    }
    return finish();
  });
}

/** @param {ReturnType<import('./install-plan.mjs').plan>} changes @param {string} harness */
function deactivate(changes, harness) {
  const config = json(changes.current("vouch/config.json"));
  if (object(config.harnesses)) delete config.harnesses[harness];
  changes.put("vouch/config.json", pretty(config));
}

/** @param {Options} options */
export function diagnose(options) {
  const config = json(read(inside(options.project, "vouch/config.json")));
  const binding = object(config.harnesses)
    ? config.harnesses[options.harness]
    : undefined;
  if (
    !object(binding) ||
    typeof binding.runtimeRoot !== "string" ||
    !["user", "project"].includes(String(binding.scope)) ||
    binding.registrationScope !== "project"
  )
    throw new Error("INSTALL-INACTIVE: project is not initialized");
  const runtimeRoot = resolve(options.project, binding.runtimeRoot);
  if (binding.scope === "user" && !isAbsolute(binding.runtimeRoot))
    throw new Error("INSTALL-VERSION: user runtime must be absolute");
  const root =
    binding.scope === "project"
      ? options.project
      : dirname(dirname(dirname(dirname(runtimeRoot))));
  const state = readInstallation(
    read(
      inside(
        binding.scope === "project" ? root : options.project,
        binding.scope === "project"
          ? statePath(options.harness)
          : `.vouch/bindings/${options.harness}.json`,
      ),
    ),
  );
  if (
    !state ||
    state.digest !== binding.digest ||
    state.harness !== options.harness ||
    state.scope !== binding.scope
  )
    throw new Error("INSTALL-VERSION: active and installed versions differ");
  if (
    runtimeRoot !==
    inside(root, `.vouch/versions/${state.digest}/${options.harness}`)
  )
    throw new Error("INSTALL-VERSION: runtime path differs");
  plan(options.project, state); // Read-only validation of the active project's registration and documents.
  if (
    options.harness === "codex" &&
    enableCodex(read(inside(options.project, ".codex/config.toml"))).content !==
      "[]\n"
  )
    throw new Error(
      "INSTALL-REGISTRATION: Codex hooks and agent depth are not enabled",
    );
  const source = files(join(runtimeRoot, "distribution"));
  if (sourceDigest(source) !== state.digest)
    throw new Error("INSTALL-VERSION: archived distribution has changed");
  const prefix = `${nativeDirectory(options.harness)}/`;
  const referenceRoot =
    binding.scope === "project"
      ? `.vouch/versions/${state.digest}/${options.harness}`
      : runtimeRoot;
  for (const [path, text] of Object.entries(source)) {
    if (
      path !== "AGENTS.md" &&
      !path.startsWith(`${prefix}hooks/`) &&
      !path.startsWith(`${prefix}registry/`) &&
      !path.startsWith(`${prefix}templates/`)
    )
      continue;
    const target = path === "AGENTS.md" ? path : path.slice(prefix.length);
    if (
      read(inside(runtimeRoot, target)) !==
      (path.endsWith(".md")
        ? installedText(text, options.harness, referenceRoot)
        : text)
    )
      throw new Error(`INSTALL-VERSION: runtime has changed: ${target}`);
  }
  return {
    v: 1,
    ok: true,
    harness: options.harness,
    scope: binding.scope,
    digest: state.digest,
    runtimeRoot,
    projectRoot: options.project,
  };
}
