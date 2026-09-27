import { spawnSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { packageRun } from "./packaging.mjs";
import { sandbox } from "./runtime.mjs";

/** Manual CLI, intentionally separate from versioned event fixtures.
 * @param {string} entry @param {string} cwd
 */
export function runDoctorEntry(entry, cwd) {
  return spawnSync(process.execPath, [entry], {
    cwd,
    input: "not a hook event",
    encoding: "utf8",
    windowsHide: true,
    timeout: 4000,
    env: {
      ...process.env,
      VOUCH_PROJECT_ROOT: join(cwd, "not-the-target"),
      VOUCH_HARNESS: "wrong",
    },
  });
}

/** @param {import('node:test').TestContext} t @param {'claude'|'codex'} harness */
export async function installDoctor(t, harness) {
  const box = await sandbox(t, { git: false });
  const root = box.path("日本語 project $ apostrophe'");
  const generated = packageRun(["--out", box.path("dist")]);
  if (generated.status !== 0) throw new Error(generated.stderr);
  await cp(box.path(`dist/${harness}`), root, { recursive: true });
  const cwd = join(root, "nested");
  await mkdir(cwd);
  return {
    box,
    root,
    directory: join(root, `.${harness}`),
    run: () =>
      runDoctorEntry(join(root, `.${harness}`, "hooks/vouch-doctor.mjs"), cwd),
  };
}
