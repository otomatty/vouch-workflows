import { test } from "node:test";
import { managedDoctor } from "../../helpers/managed-doctor.mjs";

test("managed doctor rejects malformed ownership and mismatched runtime identity", async (t) => {
  const { store, state, owned, active, inspect } = await managedDoctor(t);
  store.data.set(".cursor/hooks.json", "{}");
  for (const value of [
    "null",
    JSON.stringify({ ...state, owned: [] }),
    JSON.stringify({ ...state, owned: [{ ...owned, content: "null" }] }),
  ]) {
    store.data.set(".vouch/installations/cursor.json", value);
    t.assert.equal((await inspect()).ok, false);
  }
  store.data.set(".cursor/hooks.json", JSON.stringify(active));
  for (const identity of [
    { scope: "user" },
    { digest: "f".repeat(64) },
    { runtimeRoot: "alternate" },
    { digest: 1 },
    { runtimeRoot: null },
  ]) {
    store.data.set(
      ".vouch/installations/cursor.json",
      JSON.stringify({ ...state, ...identity }),
    );
    t.assert.equal((await inspect()).ok, false);
  }
});
