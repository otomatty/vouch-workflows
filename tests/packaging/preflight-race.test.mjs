import { mkdir } from "node:fs/promises";
import { hookTest as test } from "../helpers/hook-test.mjs";
import { tree } from "../helpers/packaging.mjs";
import { probedPackage } from "../helpers/packaging-probe.mjs";
import { sandbox } from "../helpers/runtime.mjs";

test("generation rechecks an output ancestor replaced after its directory was listed", async (t) => {
  const box = await sandbox(t);
  await mkdir(box.path("dist/claude"), { recursive: true });
  await box.write("outside/sentinel", "unchanged");
  const result = probedPackage(box.root, true);
  t.plan(5);
  t.assert.equal(JSON.parse(await box.read("probe.json")).swapped, true);
  t.assert.equal(result.status, 1);
  t.assert.match(result.stderr, /PACKAGE-LINK/);
  t.assert.deepEqual(tree(box.path("outside")), {
    sentinel: Buffer.from("unchanged").toString("base64"),
  });
  t.assert.deepEqual(tree(box.path("swapped-claude")), {});
});
