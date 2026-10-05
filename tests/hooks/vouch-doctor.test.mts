import { link, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { installDoctor, runDoctorEntry } from "../helpers/doctor.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";
import { validator } from "../helpers/registry.mjs";

test("installed doctor emits JSON failure for a missing runtime without repairing it", async (t) => {
  const install = await installDoctor(t, "claude");
  await rm(join(install.directory, "registry/budgets.json"));
  const before = tree(install.root);
  const result = install.run();
  const report = JSON.parse(result.stdout);
  t.plan(5);
  t.assert.equal(result.status, 2, result.stderr);
  t.assert.equal(result.stderr, "");
  t.assert.equal(validator("doctor-report")(report), true);
  t.assert.equal(
    report.checks.some(
      (check: { ok: boolean; detail: string }) =>
        !check.ok && check.detail.includes("budgets.json"),
    ),
    true,
  );
  t.assert.deepEqual(tree(install.root), before);
});

test("doctor rejects broken registration and a linked registration file", async (t) => {
  const install = await installDoctor(t, "claude");
  const target = join(install.directory, "settings.json");
  const original = await readFile(target, "utf8");
  await writeFile(target, "{}");
  t.plan(4);
  t.assert.equal(install.run().status, 2);
  t.assert.equal(await readFile(target, "utf8"), "{}");
  const outside = install.box.path("outside.json");
  await writeFile(outside, original);
  await rm(target);
  await link(outside, target);
  const linked = install.run();
  t.assert.equal(linked.status, 2);
  t.assert.match(linked.stdout, /FS-LINK/);
});

test("source doctor reports the missing installation descriptor instead of claiming installation", (t) => {
  const result = runDoctorEntry(
    resolve("core/hooks/vouch-doctor.mjs"),
    process.cwd(),
  );
  const report = JSON.parse(result.stdout);
  t.plan(4);
  t.assert.equal(result.status, 2, result.stderr);
  t.assert.equal(result.stderr, "");
  t.assert.equal(validator("doctor-report")(report), true);
  t.assert.equal(
    report.checks.some(
      (check: { id: string; ok: boolean }) =>
        check.id === "DOCTOR-INSTALLATION" && !check.ok,
    ),
    true,
  );
});
