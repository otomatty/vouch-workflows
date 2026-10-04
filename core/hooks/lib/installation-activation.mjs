import { isAbsolute, resolve } from "node:path";
import {
  object,
  restoreOwned,
  verifyActivationManifest,
} from "./installation-ownership.mjs";
import { verifyManagedRuntime } from "./installation-runtime.mjs";
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
  verifyActivationManifest(source, harness, state.owned);
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
