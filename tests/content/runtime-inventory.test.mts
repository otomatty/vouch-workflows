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
  t.plan(7);
  t.assert.equal(validator("runtime")(runtime), true);
  t.assert.deepEqual(runtime.files, files);
  t.assert.deepEqual(
    [...runtime.hooks, ...runtime.commands, ...runtime.statusline].sort(),
    readdirSync("core/hooks")
      .filter((name) => name.endsWith(".mjs"))
      .sort(),
  );
  t.assert.equal(
    new Set([...runtime.hooks, ...runtime.commands, ...runtime.statusline])
      .size,
    runtime.hooks.length + runtime.commands.length + runtime.statusline.length,
  );
  t.assert.deepEqual(runtime.nodeMinimum, [22, 19, 0]);
  t.assert.deepEqual(
    runtime.commands,
    [
      "vouch-doctor.mjs",
      "vouch-dod.mjs",
      "vouch-launch.mjs",
      "vouch-lifecycle.mjs",
      "vouch-migrate.mjs",
      "vouch-question.mjs",
      "vouch-report.mjs",
    ],
    "DIST-5: manual diagnostic, DoD, lifecycle, migration, question and report commands are not event wiring",
  );
  t.assert.deepEqual(
    runtime.statusline,
    ["vouch-statusline.mjs"],
    "the statusline entry is harness display wiring, not a hook event",
  );
});
