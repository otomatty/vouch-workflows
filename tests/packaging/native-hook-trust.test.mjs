import { resolve } from "node:path";
import { test } from "node:test";
import { projectHookConfig } from "../../scripts/lib/codex-hook-trust.mjs";

const source = resolve("isolated/.codex/hooks.json");
const commands = ["record startup", "record review"];
const hooks = ["sessionStart", "userPromptSubmit"].map((eventName, index) => ({
  key: `${source}:${eventName}:0:0`,
  eventName,
  currentHash: `sha256:${"a".repeat(64)}`,
  sourcePath: source,
  source: "project",
  command: commands[index] ?? "",
}));

test("native trust configuration includes only the reviewed project definitions", (t) => {
  const config = projectHookConfig(hooks, source, commands);
  t.plan(2);
  t.assert.equal((config.match(/trusted_hash = /g) ?? []).length, 2);
  t.assert.equal(config.includes(JSON.stringify(hooks[0]?.key)), true);
});

test("native trust rejects a foreign extra malformed or mismatched registration", (t) => {
  const variants = [
    [],
    [...hooks, ...hooks],
    hooks.map((hook) => ({ ...hook, source: "user" })),
    hooks.map((hook) => ({
      ...hook,
      sourcePath: resolve("elsewhere/hooks.json"),
    })),
    hooks.map((hook) => ({ ...hook, key: "foreign" })),
    hooks.map((hook) => ({ ...hook, currentHash: "untrusted" })),
    hooks.map((hook) => ({ ...hook, eventName: "sessionStart" })),
    hooks.map((hook, index) => ({
      ...hook,
      command: commands[1 - index] ?? "",
    })),
  ];
  t.plan(variants.length);
  for (const variant of variants)
    t.assert.throws(
      () => projectHookConfig(variant, source, commands),
      /NATIVE-HOOKS/,
    );
});

test("native trust also accepts the reviewed guard definition when three commands are expected", (t) => {
  const guarded = [...commands, "guard writes"];
  const all = [
    ...hooks,
    {
      key: `${source}:preToolUse:0:0`,
      eventName: "preToolUse",
      currentHash: `sha256:${"b".repeat(64)}`,
      sourcePath: source,
      source: "project",
      command: "guard writes",
    },
  ];
  t.plan(3);
  t.assert.equal(
    (projectHookConfig(all, source, guarded).match(/trusted_hash = /g) ?? [])
      .length,
    3,
  );
  t.assert.throws(
    () => projectHookConfig(hooks, source, guarded),
    /NATIVE-HOOKS/,
  );
  t.assert.throws(
    () =>
      projectHookConfig(
        all.map((hook) =>
          hook.eventName === "preToolUse"
            ? { ...hook, command: "other" }
            : hook,
        ),
        source,
        guarded,
      ),
    /NATIVE-HOOKS/,
  );
});
