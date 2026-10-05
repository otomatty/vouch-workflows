import { installDoctor } from "../helpers/doctor.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";
import { validator } from "../helpers/registry.mjs";

const harness = "codex" as "claude" | "codex";
test(`${harness} doctor runs in a Git-uninitialized project with only generated files`, async (t) => {
  const install = await installDoctor(t, harness);
  const before = tree(install.root);
  const result = install.run();
  const report = JSON.parse(result.stdout);
  t.plan(6);
  t.assert.equal(result.status, 0, result.stderr);
  t.assert.equal(result.stderr, "");
  t.assert.equal(validator("doctor-report")(report), true);
  t.assert.equal(report.ok, true);
  t.assert.deepEqual(tree(install.root), before);
  t.assert.equal(
    Object.keys(before).every(
      (name) =>
        name === "AGENTS.md" ||
        (harness === "claude" && name === "CLAUDE.md") ||
        name.startsWith(`.${harness}/`) ||
        (harness === "codex" && name.startsWith(".agents/skills/")),
    ),
    true,
  );
});
