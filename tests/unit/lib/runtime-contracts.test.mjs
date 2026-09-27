import { test } from "node:test";
import { memoryFiles } from "../../helpers/runtime.mjs";

test("FileStore contract preserves contents when an update returns null", async (t) => {
  /** @type {import('../../../core/hooks/lib/runtime-contracts.mjs').FileStore} */
  const store = memoryFiles({ file: "before" });
  t.plan(2);
  t.assert.equal(await store.updateText("file", () => null), false);
  t.assert.equal(await store.readText("file"), "before");
});
