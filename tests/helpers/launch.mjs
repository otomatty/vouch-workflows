import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { sandbox } from "./runtime.mjs";

const hash = "a".repeat(64);
/** @param {import('node:test').TestContext} t @param {'claude'|'codex'|'cursor'} [harness] */
export async function setup(t, harness = "cursor") {
  const box = await sandbox(t);
  const root = box.path("project");
  const runtime = box.path(`project/.vouch/versions/${hash}/${harness}`);
  await mkdir(runtime, { recursive: true });
  await box.write(
    `project/.vouch/versions/${hash}/${harness}/registry/installation.json`,
    JSON.stringify({ harness }),
  );
  const binding = {
    scope: "project",
    digest: hash,
    runtimeRoot: `.vouch/versions/${hash}/${harness}`,
    registrationScope: "project",
  };
  const config = { v: 1, harnesses: { [harness]: binding }, intent: "scope" };
  await box.write("project/vouch/config.json", JSON.stringify(config));
  return {
    box,
    root,
    runtime,
    binding,
    config,
    entry: pathToFileURL(`${runtime}/hooks/vouch-launch.mjs`).href,
  };
}
/** @param {string} root @param {string[]} args @param {{status:number|null,stdout:string,stderr:string}} [result] */
export function ports(
  root,
  args,
  result = { status: 0, stdout: "", stderr: "" },
) {
  const seen = {
    stdout: "",
    stderr: "",
    code: 0,
    calls: /** @type {unknown[][]} */ ([]),
  };
  const hooks = {
    environment:
      /** @type {ReturnType<typeof import('../../core/hooks/lib/env.mjs').readLaunchEnvironment>} */ ({
        projectRoot: root,
        cwd: root,
        explicit: false,
        args,
      }),
    stdout: {
      write: (/** @type {string} */ text) => {
        seen.stdout += text;
      },
    },
    stderr: {
      write: (/** @type {string} */ text) => {
        seen.stderr += text;
      },
    },
    finish: (/** @type {number} */ code) => {
      seen.code = code;
    },
    execute: (
      /** @type {string} */ entry,
      /** @type {string[]} */ words,
      /** @type {string} */ input,
      /** @type {unknown} */ selected,
    ) => {
      seen.calls.push([entry, words, input, selected]);
      return result;
    },
    input: (async function* () {
      yield Buffer.from(
        JSON.stringify({
          hook_event_name:
            args[0] === "session" ? "sessionStart" : "preToolUse",
          conversation_id: "conversation",
          tool_name: "Write",
          tool_input: { path: "src/a" },
        }),
      );
    })(),
  };
  return { hooks, seen };
}
