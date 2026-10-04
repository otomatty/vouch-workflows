import { existsSync } from "node:fs";
import { createInstallationFixture } from "../../scripts/lib/installation-fixture.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { distribution } from "../helpers/install.mjs";
import { tree } from "../helpers/packaging.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("shared installation fixtures give each case complete independent harness bytes and clean up the source", async (t) => {
  const fixture = createInstallationFixture();
  const previous = process.env.VOUCH_TEST_DISTRIBUTION;
  process.env.VOUCH_TEST_DISTRIBUTION = fixture.root;
  t.after(() => {
    if (previous === undefined) delete process.env.VOUCH_TEST_DISTRIBUTION;
    else process.env.VOUCH_TEST_DISTRIBUTION = previous;
    fixture.dispose();
  });
  const source = tree(fixture.root);
  const box = await sandbox(t);
  distribution(t, box, "codex");
  const expected = Object.fromEntries(
    Object.entries(source).filter(([path]) => path.startsWith("codex/")),
  );
  t.assert.deepEqual(tree(box.path("dist")), expected);
  await box.write("dist/codex/AGENTS.md", "case-specific change\n");
  const next = await sandbox(t);
  distribution(t, next, "codex");
  t.assert.deepEqual(tree(next.path("dist")), expected);
  t.assert.deepEqual(tree(fixture.root), source);
  fixture.dispose();
  t.assert.equal(existsSync(fixture.root), false);
});
