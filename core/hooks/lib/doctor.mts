import { isDeepStrictEqual } from "node:util";
import runtime from "../../registry/runtime.json" with { type: "json" };
import { createFileStore } from "./fs.mjs";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Required hook lists allow unrelated registrations; ordered argv stays exact. */
function contains(
  actual: unknown,
  expected: unknown,
  key: string = "",
): boolean {
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

function supportedNode(version: string) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const parts = version.split(".").map(Number);
  for (let i = 0; i < runtime.nodeMinimum.length; i++) {
    if (parts[i] !== runtime.nodeMinimum[i])
      return (parts[i] ?? 0) > (runtime.nodeMinimum[i] ?? 0);
  }
  return true;
}

export const inspectInstallation: import("./runtime-contracts.mjs").DoctorMain =
  async (files, environment, git) => {
    const installationFiles = environment.runtimeRoot
      ? await createFileStore(environment.runtimeRoot)
      : files;
    const checks: import("./runtime-contracts.mjs").DoctorCheck[] = [
      {
        id: "DOCTOR-NODE",
        ok: supportedNode(environment.nodeVersion),
        detail: `Node ${environment.nodeVersion}; requires >= ${runtime.nodeMinimum.join(".")}`,
      },
      { id: "DOCTOR-GIT", ...git },
    ];
    const directory = environment.installationRoot;
    async function read(path: string) {
      const text = await installationFiles.readText(
        directory ? `${directory}/${path}` : path,
      );
      if (!text) throw new Error(`missing or empty: ${path}`);
      return text;
    }
    async function check(id: string, inspect: () => Promise<string>) {
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
    let installation:
      | { registration: string; configuration?: string }
      | undefined;
    await check("DOCTOR-INSTALLATION", async () => {
      const value: unknown = JSON.parse(
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
        const expected: unknown = JSON.parse(
          await read("registry/registration.json"),
        );
        if (
          !object(expected) ||
          !object(expected.hooks) ||
          Object.keys(expected.hooks).length === 0
        )
          throw new Error("invalid registration template");
        if (
          !contains(JSON.parse(await read(descriptor.registration)), expected)
        )
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
        const state: unknown = JSON.parse(stateText ?? "null");
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
              actual.hooks[event].filter((candidate: unknown) =>
                isDeepStrictEqual(candidate, registration),
              ).length !== 1
            )
              throw new Error("duplicate native registration");
        }
        return `${harness}: project registration selects the managed runtime`;
      });
    }
    return { v: 1, ok: checks.every((item) => item.ok), checks };
  };
