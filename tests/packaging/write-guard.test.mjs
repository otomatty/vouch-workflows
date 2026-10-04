import { readFileSync } from "node:fs";
import { nativeRegistrationNames } from "../../core/hooks/lib/areas.mjs";
import guard from "../../core/registry/write-guard.json" with { type: "json" };
import { hookTest as test } from "../helpers/hook-test.mjs";
import { readJson } from "../helpers/registry.mjs";

test("managed native guard names agree with every harness installation descriptor", (t) => {
  for (const harness of ["claude", "codex", "cursor"]) {
    const descriptor = readJson(`harness/${harness}/installation.json`);
    t.assert.deepEqual(nativeRegistrationNames[`.${harness}`], [
      descriptor.registration,
      ...(descriptor.configuration === undefined
        ? []
        : [descriptor.configuration]),
      ...(descriptor.overrides ?? []),
    ]);
  }
});

test("both registrations route exactly the guarded tools to the guard entry", (t) => {
  const claude = readJson("harness/claude/settings.json").hooks.PreToolUse;
  const codex = readJson("harness/codex/hooks.json").hooks.PreToolUse;
  t.plan(6);
  t.assert.deepEqual(
    [
      claude.length,
      claude[0].hooks.length,
      codex.length,
      codex[0].hooks.length,
    ],
    [1, 1, 1, 1],
  );
  t.assert.equal(claude[0].matcher, Object.keys(guard.tools.claude).join("|"));
  t.assert.equal(codex[0].matcher, Object.keys(guard.tools.codex).join("|"));
  t.assert.deepEqual(claude[0].hooks[0], {
    type: "command",
    command: "node",
    args: [`\${CLAUDE_PROJECT_DIR}/.claude/hooks/vouch-guard-writes.mjs`],
  });
  t.assert.equal(
    codex[0].hooks[0].command,
    `VOUCH_HARNESS=codex node "\${VOUCH_PROJECT_ROOT:?VOUCH_PROJECT_ROOT required}/.codex/hooks/vouch-guard-writes.mjs"`,
  );
  t.assert.equal(
    codex[0].hooks[0].commandWindows,
    "$env:VOUCH_HARNESS = 'codex'; & node \"$env:VOUCH_PROJECT_ROOT/.codex/hooks/vouch-guard-writes.mjs\"; exit $LASTEXITCODE",
  );
});

test("installation descriptors name the registration files the guard protects", (t) => {
  t.plan(2);
  t.assert.deepEqual(
    JSON.parse(readFileSync("harness/claude/installation.json", "utf8")),
    {
      harness: "claude",
      registration: "settings.json",
      overrides: ["settings.local.json"],
    },
  );
  t.assert.deepEqual(
    JSON.parse(readFileSync("harness/codex/installation.json", "utf8")),
    {
      harness: "codex",
      registration: "hooks.json",
      configuration: "config.toml",
    },
  );
});
