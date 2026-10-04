import { test } from "node:test";
import { verifyDistributionAssets } from "../../../core/hooks/lib/installation-runtime.mjs";
import runtime from "../../../core/registry/runtime.json" with { type: "json" };

test("every mandatory activation asset is required independently of the source's claimed inventory", (t) => {
  for (const harness of /** @type {const} */ (["claude", "codex", "cursor"])) {
    const source = Object.fromEntries(
      runtime.assets[harness].map((path) => [path, "asset bytes"]),
    );
    source[`.${harness}/registry/runtime.json`] = JSON.stringify({
      assets: {},
    });
    source["extra.md"] = "custom additional asset";
    verifyDistributionAssets(source, harness);
    for (const path of runtime.assets[harness])
      for (const missing of [true, false]) {
        if (missing) delete source[path];
        else source[path] = "";
        const before = { ...source };
        t.assert.throws(
          () => verifyDistributionAssets(source, harness),
          (error) =>
            error instanceof Error &&
            error.message.startsWith("INSTALL-SOURCE:") &&
            error.message.includes(path),
        );
        t.assert.deepEqual(source, before);
        source[path] = "asset bytes";
      }
  }
  t.assert.throws(
    () => verifyDistributionAssets({}, "unknown"),
    /INSTALL-SOURCE/,
  );
});
