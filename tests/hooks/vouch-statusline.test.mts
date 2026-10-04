import { existsSync } from "node:fs";
import operations from "../../core/registry/operations.json" with {
  type: "json",
};
import { source } from "../helpers/commands.mjs";
import { hookTest as test } from "../helpers/hook-test.mjs";

test("the statusline entry prints one line and exits zero with or without an Intent", (t) => {
  const unset = source("vouch-statusline");
  const invalid = source("vouch-statusline", [], { VOUCH_INTENT: "../x" });
  const absent = source("vouch-statusline", [], {
    VOUCH_INTENT: "260930-none",
  });
  t.plan(4);
  t.assert.deepEqual(
    [unset.status, unset.stdout, unset.stderr],
    [0, `Vouch: ${operations.labels.ja.unset}\n`, ""],
  );
  t.assert.match(invalid.stdout, /^Vouch: .+ \(AUDIT-SCOPE\)\n$/);
  t.assert.match(absent.stdout, /^Vouch 260930-none \| 確認 \? \| 未回答 0\n$/);
  t.assert.equal(existsSync("vouch/intents/260930-none"), false);
});
