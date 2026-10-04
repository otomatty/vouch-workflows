import { test } from "node:test";
import { guardScope } from "../../../core/hooks/lib/guard-scope.mjs";
import { fakeClock } from "../../helpers/runtime.mjs";

test("guard scope derives managed protection from the trusted entry rather than tool input", async (t) => {
  const context = {
    projectRoot: "/project",
    harness: "cursor" as const,
    generation: "test",
    ...fakeClock(),
    readText: async () => null,
    locate: async () => ({
      inside: null,
      contains: false,
      kind: "missing" as const,
      links: 0,
    }),
  };
  const scope = await guardScope(
    context,
    "/home/.vouch/versions/hash/cursor/hooks/vouch-guard-writes.mjs",
  );
  t.assert.equal(scope.managed, ".cursor");
  t.assert.equal(scope.installation, null);
  t.assert.deepEqual(
    (await guardScope(context, "/other/hooks/guard.mjs")).installed,
    [],
  );
});
