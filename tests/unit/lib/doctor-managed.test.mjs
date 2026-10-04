import { test } from "node:test";
import { managedDoctor } from "../../helpers/managed-doctor.mjs";

test("managed doctor inspects the selected runtime separately and detects missing or duplicate native registration", async (t) => {
  const { store, active, inspect } = await managedDoctor(t);
  t.assert.equal((await inspect()).ok, true);
  store.data.set(
    ".cursor/hooks.json",
    JSON.stringify({
      ...active,
      hooks: {
        sessionStart: [
          ...active.hooks.sessionStart,
          ...active.hooks.sessionStart,
        ],
      },
    }),
  );
  t.assert.equal((await inspect()).ok, false);
  store.data.set(".cursor/hooks.json", "{}");
  t.assert.equal((await inspect()).ok, false);
});
