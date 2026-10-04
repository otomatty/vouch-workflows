import { statSync } from "node:fs";
import { win32 } from "node:path";

/** Select from the host environment, independently of an isolated child's PATH.
 * Discovery does not launch or warm up either shell; execution failures are final.
 * @param {NodeJS.ProcessEnv} [source] @returns {string} */
export function windowsShell(source = process.env) {
  const env = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key.toUpperCase(), value]),
  );
  for (const entry of (env.PATH ?? "").split(";")) {
    const directory = entry.trim().replace(/^"(.*)"$/, "$1");
    if (!win32.isAbsolute(directory) || win32.parse(directory).root.length < 2)
      continue;
    const candidate = win32.join(directory, "pwsh.exe");
    try {
      if (statSync(candidate, { throwIfNoEntry: false })?.isFile())
        return candidate;
    } catch {
      // An inaccessible PATH entry is not an available shell.
    }
  }
  return win32.join(
    env.SYSTEMROOT ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
}
