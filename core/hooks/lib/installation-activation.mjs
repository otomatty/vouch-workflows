import { isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  block,
  json,
  object,
  registration,
  restoreOwned,
  skillsDirectory,
  verifyActivationManifest,
} from "./installation-ownership.mjs";
import {
  installedText,
  markdownDestination,
  verifyManagedRuntime,
} from "./installation-runtime.mjs";
import { enableCodex } from "./installation-toml.mjs";

/** Read-only managed activation validation shared by doctor and automatic displays.
 * @param {import('./runtime-contracts.mjs').FileStore} files
 * @param {import('./runtime-contracts.mjs').FileStore} installationFiles
 * @param {import('./runtime-contracts.mjs').DoctorEnvironment & {runtimeRoot:string,harness:import('./contracts.mjs').Harness}} environment */
export async function verifyManagedActivation(
  files,
  installationFiles,
  environment,
) {
  const harness = environment.harness;
  const localState = await files.readText(
    `.vouch/installations/${harness}.json`,
  );
  const stateText =
    localState ?? (await files.readText(`.vouch/bindings/${harness}.json`));
  /** @type {unknown} */ const state = JSON.parse(stateText ?? "null");
  if (
    !object(state) ||
    state.v !== 1 ||
    state.harness !== harness ||
    !Array.isArray(state.owned)
  )
    throw new Error("missing managed activation descriptor");
  const config = JSON.parse(
    (await files.readText("vouch/config.json")) ?? "null",
  );
  const activation =
    object(config) && object(config.harnesses)
      ? config.harnesses[harness]
      : null;
  if (
    !object(config) ||
    config.v !== 1 ||
    !object(activation) ||
    state.scope !== (localState === null ? "user" : "project") ||
    typeof state.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(state.digest) ||
    typeof state.runtimeRoot !== "string" ||
    activation.scope !== state.scope ||
    activation.digest !== state.digest ||
    typeof activation.runtimeRoot !== "string" ||
    activation.registrationScope !== "project"
  )
    throw new Error("managed activation identity differs");
  const selectedRoot = resolve(environment.projectRoot, activation.runtimeRoot);
  const canonical = `.vouch/versions/${state.digest}/${harness}`;
  if (
    selectedRoot !== environment.runtimeRoot ||
    resolve(environment.projectRoot, state.runtimeRoot) !== selectedRoot ||
    (state.scope === "project" &&
      selectedRoot !== resolve(environment.projectRoot, canonical)) ||
    (state.scope === "user" &&
      (!isAbsolute(state.runtimeRoot) ||
        !isAbsolute(activation.runtimeRoot) ||
        !selectedRoot.replaceAll("\\", "/").endsWith(`/${canonical}`)))
  )
    throw new Error("managed runtime path differs");
  const source = await verifyManagedRuntime(
    installationFiles,
    {
      harness,
      scope: String(state.scope),
      digest: state.digest,
    },
    selectedRoot,
  );
  verifyActivationContents(
    source,
    {
      harness,
      scope: String(state.scope),
      runtimeRoot: selectedRoot,
      projectRoot: environment.projectRoot,
    },
    state.owned,
  );
  for (const entry of state.owned) {
    restoreOwned(await files.readText(entry.path), entry);
  }
  if (
    harness === "codex" &&
    enableCodex(await files.readText(".codex/config.toml")).content !== "[]\n"
  )
    throw new Error("active Codex hooks or agent depth differ");
  return `${harness}: project owned activation selects the managed runtime`;
}

/** Activation files use the exact same materialization in setup and diagnostics.
 * @param {Record<string,string>} source @param {string} harness @param {string} referenceRoot */
export function activationFiles(source, harness, referenceRoot) {
  return Object.fromEntries(
    Object.entries(source)
      .filter(
        ([path]) =>
          path.startsWith(`${skillsDirectory(harness)}/`) ||
          path.startsWith(`.${harness}/agents/`),
      )
      .map(([path, text]) => [
        path,
        path.endsWith(".md") || path.endsWith(".toml")
          ? installedText(text, harness, referenceRoot)
          : text,
      ]),
  );
}

/** @param {string} harness @param {string} referenceRoot */
export function activationGuidance(harness, referenceRoot) {
  const entries = [
    {
      path: "AGENTS.md",
      kind: "block",
      content: `Vouch を ${harness} で利用する時は、選択した本体の [共通ルール](${markdownDestination(`${referenceRoot}/AGENTS.md`)}) を読む。規則と成果物はこのプロジェクトの vouch/ に保存する。`,
    },
  ];
  if (harness === "claude")
    entries.push({ path: "CLAUDE.md", kind: "block", content: "@AGENTS.md" });
  if (harness === "cursor")
    entries.push({
      path: ".cursor/rules/vouch.mdc",
      kind: "file",
      content: `---\ndescription: Vouch workflow activation\nalwaysApply: true\n---\nRead [Vouch rules](${markdownDestination(`${referenceRoot}/AGENTS.md`)}) when using Vouch in this project.`,
    });
  return entries;
}

/** Compare contributions to setup-generated data, independently of mutable receipts.
 * @param {Record<string,string>} source
 * @param {{harness:string,scope:string,runtimeRoot:string,projectRoot:string,registrationScope?:'project'|'user'}} context
 * @param {unknown[]} owned */
export function verifyActivationContents(source, context, owned) {
  const { harness, scope, runtimeRoot, projectRoot } = context;
  const projectActivation = context.registrationScope !== "user";
  verifyActivationManifest(source, harness, owned, projectActivation);
  const referenceRoot =
    scope === "project"
      ? relative(projectRoot, runtimeRoot).replaceAll("\\", "/")
      : runtimeRoot.replaceAll("\\", "/");
  const expectedFiles = activationFiles(source, harness, referenceRoot);
  const guidance = projectActivation
    ? activationGuidance(harness, referenceRoot)
    : [];
  for (const entry of owned) {
    if (
      !object(entry) ||
      typeof entry.path !== "string" ||
      typeof entry.content !== "string" ||
      (entry.previous !== null && typeof entry.previous !== "string") ||
      (entry.kind === "file" && entry.previous !== null)
    )
      throw new Error("INSTALL-STATE: invalid owned contribution");
    let matches;
    if (entry.kind === "hooks") {
      const expected = /** @type {Record<string,unknown>} */ (
        registration(
          harness,
          runtimeRoot,
          projectActivation ? "project" : "user",
          projectActivation ? projectRoot : undefined,
        )
      );
      if (json(entry.previous).statusLine !== undefined)
        delete expected.statusLine;
      matches = isDeepStrictEqual(json(entry.content), expected);
    } else if (entry.kind === "toml") {
      const actual = JSON.parse(entry.content);
      const expected = JSON.parse(enableCodex(entry.previous).content);
      if (Array.isArray(actual))
        for (let index = 0; index < expected.length; index++)
          if (
            object(actual[index]) &&
            !Object.hasOwn(actual[index], "createdTable")
          )
            delete expected[index].createdTable;
      matches = isDeepStrictEqual(actual, expected);
    } else {
      const document = guidance.find((item) => item.path === entry.path);
      const expected =
        entry.kind === "block"
          ? block(entry.previous, harness, document?.content ?? "")
          : (expectedFiles[entry.path] ?? document?.content);
      matches = entry.content === expected;
    }
    if (!matches)
      throw new Error(
        `INSTALL-STATE: owned contribution differs from trusted activation: ${entry.path}`,
      );
  }
}
