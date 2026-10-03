import { isDeepStrictEqual } from "node:util";
import runtime from "../../registry/runtime.json" with { type: "json" };
import { createFileStore } from "./fs.mjs";

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
    await check("DOCTOR-ACTIVATION", async () => {
      const harness = environment.harness;
      const stateText =
        (await files.readText(`.vouch/installations/${harness}.json`)) ??
        (await files.readText(`.vouch/bindings/${harness}.json`));
      /** @type {unknown} */ const state = JSON.parse(stateText ?? "null");
      if (
        !object(state) ||
        state.v !== 1 ||
        state.harness !== harness ||
        !Array.isArray(state.owned)
      )
        throw new Error("missing managed activation descriptor");
      const entry = state.owned.find(
        (item) => object(item) && item.kind === "hooks",
      );
      if (
        !object(entry) ||
        typeof entry.path !== "string" ||
        typeof entry.content !== "string"
      )
        throw new Error("missing owned registration");
      const actual = JSON.parse((await files.readText(entry.path)) ?? "null");
      const expected = JSON.parse(entry.content);
      if (!contains(actual, expected))
        throw new Error("active native registration differs");
      if (!object(actual.hooks) || !object(expected.hooks))
        throw new Error("invalid native registration");
      for (const [event, registrations] of Object.entries(expected.hooks)) {
        if (
          !Array.isArray(registrations) ||
          !Array.isArray(actual.hooks[event])
        )
          throw new Error("invalid native event");
        for (const registration of registrations)
          if (
            actual.hooks[event].filter((/** @type {unknown} */ candidate) =>
              isDeepStrictEqual(candidate, registration),
            ).length !== 1
          )
            throw new Error("duplicate native registration");
      }
      return `${harness}: project registration selects the managed runtime`;
    });
  }
  return { v: 1, ok: checks.every((item) => item.ok), checks };
}
