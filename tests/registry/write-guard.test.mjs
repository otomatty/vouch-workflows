import { test } from "node:test";
import guard from "../../core/registry/write-guard.json" with { type: "json" };
import { readInventory } from "../helpers/fixtures.mjs";
import { validator } from "../helpers/registry.mjs";

test("write-guard satisfies its closed registry schema", (t) => {
  const validate = validator("write-guard");
  t.plan(3);
  t.assert.equal(validate(guard), true, JSON.stringify(validate.errors));
  t.assert.equal(validate({ ...guard, unknown: true }), false);
  t.assert.equal(
    validate({
      ...guard,
      tools: { ...guard.tools, claude: { Write: "anything" } },
    }),
    false,
  );
});

test("guarded tools are exactly the captured artifact-guard PreToolUse kinds", (t) => {
  const kinds = readInventory().kinds.filter(
    (kind) =>
      kind.event === "PreToolUse" && kind.purposes.includes("artifact-guard"),
  );
  t.plan(3);
  for (const harness of /** @type {const} */ (["claude", "codex"]))
    t.assert.deepEqual(
      Object.keys(guard.tools[harness]).sort(),
      kinds
        .filter((kind) => kind.harness === harness)
        .map((kind) => kind.tool)
        .sort(),
      `${harness}: TEST-7 captures back every guarded tool`,
    );
  t.assert.equal(
    kinds.every((kind) => kind.fixtures.length > 0),
    true,
  );
});

test("shell readers exclude removers and worktree-changing git subcommands", (t) => {
  const { readers, removers, git } = guard.shell;
  t.plan(2);
  t.assert.deepEqual(
    removers.filter((name) => readers.includes(name)),
    [],
  );
  t.assert.deepEqual(
    git.commands.filter((name) =>
      [
        "am",
        "apply",
        "checkout",
        "clean",
        "merge",
        "mv",
        "pull",
        "rebase",
        "reset",
        "restore",
        "rm",
        "stash",
        "switch",
      ].includes(name),
    ),
    [],
  );
});
