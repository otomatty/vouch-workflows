import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** @param {import('node:test').TestContext} t @param {string} name @param {string} actual */
export async function assertGolden(t, name, actual) {
  if (!/^[a-z0-9-]+\.(?:jsonl|md)$/.test(name))
    throw new Error("TEST-6: invalid golden name");
  const path = resolve("tests/golden", name);
  if (process.env.UPDATE_GOLDEN === "1") {
    await mkdir(resolve("tests/golden"), { recursive: true });
    await writeFile(path, actual);
  }
  t.assert.equal(
    actual,
    await readFile(path, "utf8"),
    "TEST-6: complete rendering",
  );
}
