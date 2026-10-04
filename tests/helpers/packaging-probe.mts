import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function probedPackage(root: string, swap: boolean = false) {
  return spawnSync(
    process.execPath,
    [
      `--import=${pathToFileURL(resolve("tests/fixtures/packaging/preflight-probe.mjs")).href}`,
      "scripts/package.mjs",
      "--out",
      resolve(root, "dist"),
      ...(swap ? [] : ["--check"]),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
      env: {
        ...process.env,
        VOUCH_TEST_ROOT: root,
        VOUCH_TEST_SWAP: swap ? "1" : "0",
      },
    },
  );
}
