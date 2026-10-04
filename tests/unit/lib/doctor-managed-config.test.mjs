import { test } from "node:test";
import { managedDoctor } from "../../helpers/managed-doctor.mjs";

test("managed doctor rejects invalid project selections and requires its activation receipt", async (t) => {
  const { store, state, config, inspect } = await managedDoctor(t);
  store.data.set(".vouch/installations/cursor.json", JSON.stringify(state));
  for (const invalid of [
    null,
    {},
    { ...config, harnesses: [] },
    { ...config, harnesses: { cursor: null } },
    {
      ...config,
      harnesses: {
        cursor: { ...config.harnesses.cursor, runtimeRoot: "alternate" },
      },
    },
  ]) {
    store.data.set("vouch/config.json", JSON.stringify(invalid));
    t.assert.equal((await inspect()).ok, false);
  }
  store.data.set("vouch/config.json", JSON.stringify(config));
  t.assert.equal((await inspect()).ok, true);
  store.data.delete(".vouch/installations/cursor.json");
  t.assert.equal((await inspect()).ok, false);
});
