import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

/** @param {Awaited<ReturnType<typeof sandbox>>} box @param {string} render */
async function example(box, render) {
  for (const name of ["core/input", "harness/example", "scripts"])
    await mkdir(box.path(name), { recursive: true });
  await copyFile("scripts/package.mjs", box.path("scripts/package.mjs"));
  await writeFile(
    box.path("harness/example/manifest.mjs"),
    `export default {tokens:{"{{HARNESS_DIR}}":".sample"},files:[{from:"core/input",to:"agents",render:${render}}]};\n`,
  );
  await writeFile(box.path("core/input/one.md"), "path {{HARNESS_DIR}}/x\n");
  return (/** @type {string[]} */ args = []) =>
    spawnSync(process.execPath, [box.path("scripts/package.mjs"), ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    });
}

test("packager renders mapped files after token replacement under the returned path", async (t) => {
  const box = await sandbox(t, { git: false });
  const run = await example(
    box,
    '(name,text)=>[name.replace(/\\.md$/,".toml"),text.toUpperCase()]',
  );
  t.plan(6);
  const generated = run();
  t.assert.equal(generated.status, 0, generated.stderr);
  t.assert.deepEqual(Object.keys(tree(box.path("dist/example"))), [
    "agents/one.toml",
  ]);
  t.assert.equal(
    await box.read("dist/example/agents/one.toml"),
    "PATH .SAMPLE/X\n",
  );
  t.assert.equal(run(["--check"]).status, 0);
  await box.write("dist/example/agents/one.md", "stale");
  const extra = run(["--check"]);
  t.assert.equal(extra.status, 1);
  t.assert.match(extra.stderr, /PACKAGE-EXTRA/);
});

test("packager rejects a rendered path outside the mapping and a failing render before writing", async (t) => {
  t.plan(6);
  for (const [render, message] of [
    ['(name,text)=>["../"+name,text]', /PACKAGE-PATH/],
    ['()=>{throw new Error("AGENT-FORMAT: sample")}', /AGENT-FORMAT/],
  ]) {
    const box = await sandbox(t, { git: false });
    const result = (await example(box, String(render)))();
    t.assert.equal(result.status, 1);
    t.assert.match(result.stderr, /** @type {RegExp} */ (message));
    t.assert.equal(existsSync(box.path("dist")), false, "nothing is written");
  }
});
