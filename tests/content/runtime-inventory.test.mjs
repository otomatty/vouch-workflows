import { readdirSync } from "node:fs";
import { test } from "node:test";
import { readJson, validator } from "../helpers/registry.mjs";

test("runtime inventory classifies every entry and every core file without omission", (t) => {
  const runtime = readJson("core/registry/runtime.json");
  const files = readdirSync("core", { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(mjs|json)$/.test(entry.name))
    .map((entry) =>
      `${entry.parentPath}/${entry.name}`
        .replaceAll("\\", "/")
        .replace(/^core\//, ""),
    )
    .sort();
  t.plan(6);
  t.assert.equal(validator("runtime")(runtime), true);
  t.assert.deepEqual(runtime.files, files);
  t.assert.deepEqual(
    [...runtime.hooks, ...runtime.commands].sort(),
    readdirSync("core/hooks")
      .filter((name) => name.endsWith(".mjs"))
      .sort(),
  );
  t.assert.equal(
    new Set([...runtime.hooks, ...runtime.commands]).size,
    runtime.hooks.length + runtime.commands.length,
  );
  t.assert.deepEqual(runtime.nodeMinimum, [22, 19, 0]);
  t.assert.deepEqual(
    runtime.commands,
    ["vouch-doctor.mjs", "vouch-dod.mjs"],
    "DIST-5: manual diagnostic and DoD commands are not event wiring",
  );
});
