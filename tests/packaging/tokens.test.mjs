import { spawnSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("packager replaces declared Markdown tokens and rejects unresolved tokens before writing", async (t) => {
  const box = await sandbox(t, { git: false });
  for (const name of ["core/input", "harness/example", "scripts"])
    await mkdir(box.path(name), { recursive: true });
  await copyFile("scripts/package.mjs", box.path("scripts/package.mjs"));
  await writeFile(
    box.path("harness/example/manifest.mjs"),
    'export default {tokens:{"{{HARNESS_DIR}}":".sample"},files:[{from:"core/input",to:"copied"}]};\n',
  );
  await writeFile(
    box.path("core/input/guide.md"),
    'node "{{HARNESS_DIR}}/hooks/example.mjs"\n',
  );
  await writeFile(
    box.path("core/input/data.json"),
    '{"literal":"{{HARNESS_DIR}}"}\n',
  );
  const run = (/** @type {string[]} */ args = []) =>
    spawnSync(process.execPath, [box.path("scripts/package.mjs"), ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    });
  t.plan(9);
  const generated = run();
  t.assert.equal(generated.status, 0, generated.stderr);
  t.assert.equal(
    await box.read("dist/example/copied/guide.md"),
    'node ".sample/hooks/example.mjs"\n',
  );
  t.assert.equal(
    await box.read("dist/example/copied/data.json"),
    '{"literal":"{{HARNESS_DIR}}"}\n',
  );
  t.assert.equal(run(["--check"]).status, 0);
  const before = tree(box.path("dist"));
  await writeFile(
    box.path("core/input/guide.md"),
    "changed {{UNKNOWN_TOKEN}}\n",
  );
  for (const args of [[], ["--check"]]) {
    const result = run(args);
    t.assert.notEqual(result.status, 0);
    t.assert.match(result.stderr, /PACKAGE-TOKEN/);
  }
  t.assert.deepEqual(tree(box.path("dist")), before);
});
