import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Generate a private immutable source; case copies remain independently writable. */
export function createInstallationFixture() {
  const root = mkdtempSync(join(tmpdir(), "vouch-distribution-"));
  const dispose = () => rmSync(root, { recursive: true, force: true });
  try {
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package.mjs"), "--out", root],
      { encoding: "utf8", windowsHide: true, timeout: 4000 },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        `TEST-FIXTURE: ${result.stderr || result.error?.message || result.stdout}`,
        { cause: result.error },
      );
    return { root, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
