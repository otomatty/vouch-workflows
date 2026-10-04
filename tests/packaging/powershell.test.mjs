import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { windowsShell } from "../../scripts/lib/powershell.mjs";

test("Windows shell discovery prefers the first available absolute PowerShell 7 without launching it", (t) => {
  const source = {
    pAtH: 'relative;C:relative;\\root-relative;"C:\\Program Files\\PowerShell\\7";D:\\later',
    sYsTeMrOoT: "C:\\Windows",
  };
  const before = { ...source };
  /** @type {string[]} */
  const inspected = [];
  t.mock.method(fs, "statSync", (/** @type {string} */ path) => {
    inspected.push(path);
    return {
      isFile: () => path === "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.assert.equal(
    windowsShell(source),
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  );
  t.assert.deepEqual(inspected, ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"]);
  t.assert.deepEqual(source, before);
});

test("Windows shell discovery ignores missing files and directories and falls back to the OS shell", (t) => {
  t.mock.method(fs, "statSync", (/** @type {string} */ path) =>
    path.startsWith("D:") ? { isFile: () => false } : undefined,
  );
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.assert.equal(
    windowsShell({
      Path: "C:\\missing;D:\\directory",
      SystemRoot: "E:\\Windows",
    }),
    "E:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  t.assert.equal(
    windowsShell({}),
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
});

test("Windows shell discovery keeps searching after an inaccessible host PATH entry", (t) => {
  t.mock.method(fs, "statSync", (/** @type {string} */ path) => {
    if (path.startsWith("C:")) throw new Error("inaccessible");
    return { isFile: () => true };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.assert.equal(
    windowsShell({ PATH: "C:\\inaccessible;D:\\PowerShell\\7" }),
    "D:\\PowerShell\\7\\pwsh.exe",
  );
});
