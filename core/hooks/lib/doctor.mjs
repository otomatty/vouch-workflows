import runtime from "../../registry/runtime.json" with { type: "json" };
import { createFileStore } from "./fs.mjs";
import { restoreOwned } from "./installation-ownership.mjs";
import { verifyManagedRuntime } from "./installation-runtime.mjs";
import { enableCodex } from "./installation-toml.mjs";

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Required hook lists allow unrelated registrations; ordered argv stays exact.
 * @param {unknown} actual @param {unknown} expected @param {string} [key] @returns {boolean}
 */
function contains(actual, expected, key = "") {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (key === "args")
      return JSON.stringify(actual) === JSON.stringify(expected);
    return expected.every((item) =>
      actual.some((candidate) => contains(candidate, item)),
    );
  }
  if (object(expected))
    return (
      object(actual) &&
      Object.entries(expected).every(
        ([field, value]) =>
          Object.hasOwn(actual, field) && contains(actual[field], value, field),
      )
    );
  return actual === expected;
}

/** @param {string} version */
function supportedNode(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const parts = version.split(".").map(Number);
  for (let i = 0; i < runtime.nodeMinimum.length; i++) {
    if (parts[i] !== runtime.nodeMinimum[i])
      return (parts[i] ?? 0) > (runtime.nodeMinimum[i] ?? 0);
  }
  return true;
}

/** @type {import('./runtime-contracts.mjs').DoctorMain} */
export async function inspectInstallation(files, environment, git) {
  const installationFiles = environment.runtimeRoot
    ? await createFileStore(environment.runtimeRoot)
    : files;
  /** @type {import('./runtime-contracts.mjs').DoctorCheck[]} */
  const checks = [
    {
      id: "DOCTOR-NODE",
      ok: supportedNode(environment.nodeVersion),
      detail: `Node ${environment.nodeVersion}; requires >= ${runtime.nodeMinimum.join(".")}`,
    },
    { id: "DOCTOR-GIT", ...git },
  ];
  const directory = environment.installationRoot;
  /** @param {string} path */
  async function read(path) {
    const text = await installationFiles.readText(
      directory ? `${directory}/${path}` : path,
    );
    if (!text) throw new Error(`missing or empty: ${path}`);
    return text;
  }
  /** @param {string} id @param {()=>Promise<string>} inspect */
  async function check(id, inspect) {
    try {
      checks.push({ id, ok: true, detail: await inspect() });
    } catch (error) {
      checks.push({
        id,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const path of runtime.files)
    await check("DOCTOR-FILE", async () => {
      await read(path);
      return path;
    });
  /** @type {{registration:string,configuration?:string}|undefined} */ let installation;
  await check("DOCTOR-INSTALLATION", async () => {
    /** @type {unknown} */ const value = JSON.parse(
      await read("registry/installation.json"),
    );
    if (
      !object(value) ||
      !["claude", "codex", "cursor"].includes(String(value.harness)) ||
      typeof value.registration !== "string" ||
      !/^[a-z][a-z-]*\.json$/.test(value.registration) ||
      (value.configuration !== undefined &&
        (typeof value.configuration !== "string" ||
          !/^[a-z][a-z-]*\.toml$/.test(value.configuration)))
    )
      throw new Error("invalid installation descriptor");
    installation = {
      registration: value.registration,
      ...(typeof value.configuration === "string"
        ? { configuration: value.configuration }
        : {}),
    };
    return String(value.harness);
  });
  if (installation) {
    const descriptor = installation;
    await check("DOCTOR-REGISTRATION", async () => {
      /** @type {unknown} */ const expected = JSON.parse(
        await read("registry/registration.json"),
      );
      if (
        !object(expected) ||
        !object(expected.hooks) ||
        Object.keys(expected.hooks).length === 0
      )
        throw new Error("invalid registration template");
      if (!contains(JSON.parse(await read(descriptor.registration)), expected))
        throw new Error(
          "required registration differs from installed template",
        );
      return descriptor.registration;
    });
    if (descriptor.configuration) {
      const path = descriptor.configuration;
      await check("DOCTOR-CONFIGURATION", async () => {
        await read(path);
        return `${path}: present; TOML semantics not validated`;
      });
    }
  }
  if (environment.runtimeRoot && environment.harness) {
    const harness = environment.harness;
    await check("DOCTOR-ACTIVATION", async () => {
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
      const selectedRoot = resolve(
        environment.projectRoot,
        activation.runtimeRoot,
      );
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
      if (!state.owned.some((item) => object(item) && item.kind === "hooks"))
        throw new Error("missing owned registration");
      await verifyManagedRuntime(
        installationFiles,
        {
          harness,
          scope: String(state.scope),
          digest: state.digest,
        },
        selectedRoot,
      );
      for (const entry of state.owned) {
        if (!object(entry) || typeof entry.path !== "string")
          throw new Error("invalid owned activation entry");
        restoreOwned(await files.readText(entry.path), entry);
      }
      if (
        harness === "codex" &&
        enableCodex(await files.readText(".codex/config.toml")).content !==
          "[]\n"
      )
        throw new Error("active Codex hooks or agent depth differ");
      return `${harness}: project owned activation selects the managed runtime`;
    });
  }
  return { v: 1, ok: checks.every((item) => item.ok), checks };
}

import { isAbsolute, resolve } from "node:path";
