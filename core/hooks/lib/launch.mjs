import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { readLaunchEnvironment } from "./env.mjs";
import { createFileStore, descriptorWriter, readDescriptor } from "./fs.mjs";
import { cursorInput, cursorOutput } from "./transport.mjs";

const actions = /** @type {Record<string,string>} */ ({
  session: "vouch-record-session-start.mjs",
  prompt: "vouch-record-intent-review.mjs",
  guard: "vouch-guard-writes.mjs",
  stop: "vouch-record-aside-answer.mjs",
  doctor: "vouch-doctor.mjs",
  dod: "vouch-dod.mjs",
  lifecycle: "vouch-lifecycle.mjs",
  migrate: "vouch-migrate.mjs",
  question: "vouch-question.mjs",
  report: "vouch-report.mjs",
  statusline: "vouch-statusline.mjs",
});
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Only an on-disk opt-in selects a root; native stdin never selects a project or Intent.
 * @param {string} candidate @param {boolean} explicit */
async function findProject(candidate, explicit) {
  if (!isAbsolute(candidate))
    throw new Error("ENV-CONFIG: absolute project root required");
  let root = resolve(candidate);
  for (;;) {
    const files = await createFileStore(root);
    const text = await files.readText("vouch/config.json");
    if (text !== null) {
      /** @type {unknown} */ const config = JSON.parse(text);
      if (!object(config) || config.v !== 1 || !object(config.harnesses))
        throw new Error("INSTALL-CONFIG: invalid project activation");
      return { root, config };
    }
    const parent = dirname(root);
    if (explicit || parent === root) return null;
    root = parent;
  }
}

/** Managed process boundary; old direct product entrypoints remain compatible.
 * @param {string} entryUrl
 * @param {{finish:(code:number)=>void, stdout?:{write:(text:string)=>unknown},stderr?:{write:(text:string)=>unknown},
 * environment?:ReturnType<typeof readLaunchEnvironment>,input?:AsyncIterable<Uint8Array>,
 * execute?:import('./launch-process.mjs').executeProduct}} ports */
export async function launch(entryUrl, ports) {
  const stderr = ports.stderr ?? descriptorWriter(2);
  const stdout = ports.stdout ?? descriptorWriter(1);
  const options = ports.environment ?? readLaunchEnvironment();
  const [action = "", scope = "manual", ...rest] = options.args;
  const passCursor = () =>
    stdout.write(
      `${JSON.stringify(
        cursorOutput(action, {
          status: 0,
          stdout: "",
          stderr: "",
        }),
      )}\n`,
    );
  const product = actions[action];
  const native = ["session", "prompt", "guard", "stop"].includes(action);
  const display = action === "statusline" && scope !== "manual";
  let harness = "";
  try {
    if (!product || !["manual", "project", "user"].includes(scope))
      throw new Error("INSTALL-ARGS: unknown launcher operation or scope");
    const runtimeRoot = resolve(dirname(fileURLToPath(entryUrl)), "..");
    const locatedHarness = basename(runtimeRoot).replace(/^\./, "");
    if (["claude", "codex", "cursor"].includes(locatedHarness))
      harness = locatedHarness;
    const runtime = await createFileStore(runtimeRoot);
    /** @type {unknown} */ const descriptor = JSON.parse(
      (await runtime.readText("registry/installation.json")) ?? "null",
    );
    if (
      !object(descriptor) ||
      !["claude", "codex", "cursor"].includes(String(descriptor.harness)) ||
      (harness !== "" && descriptor.harness !== harness)
    )
      throw new Error("INSTALL-RUNTIME: invalid runtime descriptor");
    harness = /** @type {string} */ (descriptor.harness);
    const project = await findProject(
      scope === "project" && rest[0]
        ? rest[0] === "."
          ? options.cwd
          : rest[0]
        : options.projectRoot,
      (scope === "project" && Boolean(rest[0])) || options.explicit,
    );
    if (!project) {
      if (!native && !display)
        throw new Error(
          "INSTALL-INACTIVE: initialize this project before using Vouch",
        );
      if (harness === "cursor") passCursor();
      return;
    }
    const binding = /** @type {Record<string,unknown>} */ (
      project.config.harnesses
    )[harness];
    if (binding === undefined && (native || display)) {
      if (harness === "cursor") passCursor();
      return;
    }
    if (
      !object(binding) ||
      !["user", "project"].includes(String(binding.scope)) ||
      typeof binding.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(binding.digest) ||
      typeof binding.runtimeRoot !== "string" ||
      binding.registrationScope !== "project"
    )
      throw new Error("INSTALL-INACTIVE: harness is not activated");
    const selectedRoot = resolve(project.root, binding.runtimeRoot);
    if (
      binding.scope === "project" &&
      (isAbsolute(binding.runtimeRoot) ||
        relative(project.root, selectedRoot).startsWith(".."))
    )
      throw new Error("INSTALL-CONFIG: project runtime escapes its root");
    if (binding.scope === "user" && !isAbsolute(binding.runtimeRoot))
      throw new Error("INSTALL-CONFIG: user runtime must be absolute");
    if (
      !selectedRoot
        .replaceAll("\\", "/")
        .endsWith(`/.vouch/versions/${binding.digest}/${harness}`)
    )
      throw new Error("INSTALL-VERSION: activation digest and runtime differ");
    const selected =
      selectedRoot === runtimeRoot ? null : await runtime.locate(selectedRoot);
    const sameRuntime =
      selected === null ||
      (selected.kind === "directory" && selected.inside === "");
    if (
      native &&
      (!sameRuntime ||
        (scope === "user" && binding.registrationScope === "project"))
    ) {
      if (harness === "cursor") passCursor();
      return;
    }
    if (!sameRuntime && !display)
      throw new Error("INSTALL-VERSION: invoke the selected runtime");
    const intent = project.config.intent ?? "";
    if (
      typeof intent !== "string" ||
      (intent && !/^[a-z0-9][a-zA-Z0-9_-]{0,127}$/.test(intent))
    )
      throw new Error("INSTALL-CONFIG: invalid Intent");
    if (display) {
      const { verifyManagedActivation } = await import(
        "./installation-activation.mjs"
      );
      await verifyManagedActivation(
        await createFileStore(project.root),
        await createFileStore(selectedRoot),
        {
          projectRoot: project.root,
          installationRoot: "",
          runtimeRoot: selectedRoot,
          harness: /** @type {import('./contracts.mjs').Harness} */ (harness),
          nodeVersion: process.versions.node,
        },
      );
    }
    let input = "";
    if (native) {
      const chunks = [];
      let size = 0;
      for await (const chunk of ports.input ?? readDescriptor(0)) {
        size += chunk.length;
        if (size >= 1024 * 1024)
          throw new Error("HOOK-14: input must be smaller than 1 MiB");
        chunks.push(chunk);
      }
      input = Buffer.concat(chunks).toString("utf8");
      if (harness === "cursor") {
        const normalized = cursorInput(JSON.parse(input), project.root);
        if (normalized === null) {
          passCursor();
          return;
        }
        input = JSON.stringify(normalized);
      }
    }
    const execute =
      ports.execute ?? (await import("./launch-process.mjs")).executeProduct;
    const productRoot = runtimeRoot;
    const result = execute(
      join(productRoot, "hooks", product),
      scope === "project" ? rest.slice(1) : rest,
      input,
      {
        projectRoot: project.root,
        runtimeRoot: productRoot,
        harness: /** @type {import('./contracts.mjs').Harness} */ (harness),
        intent,
      },
    );
    if (harness === "cursor" && native) {
      stdout.write(`${JSON.stringify(cursorOutput(action, result))}\n`);
      if (result.status !== 2 && result.stderr) stderr.write(result.stderr);
      ports.finish(0);
    } else {
      if (result.stdout) stdout.write(result.stdout);
      if (result.stderr) stderr.write(result.stderr);
      ports.finish(result.status ?? (native || display ? 0 : 2));
    }
  } catch (error) {
    stderr.write(
      `VOUCH-LAUNCH: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (harness === "cursor" && native) passCursor();
    ports.finish(native || display ? 0 : 2);
  }
}
